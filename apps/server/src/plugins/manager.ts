// Plugins: where they're kept, loading them into workers, calling them, and
// installing them from GitHub or a zip, as MyGo Music's internal/plugin does.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { unzipSync } from 'fflate'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { COMPAT_VERSION, type AdminPlugin, type Manifest, type PluginPreview } from '@antwen-music/protocol'
import { config } from '../config.ts'
import type { DB } from '../db.ts'
import type { FromWorker, ToWorker, WorkerInit } from './worker.ts'

const pluginName = /^[a-z0-9][a-z0-9._-]*$/

/** How a plugin reaches the network: direct, through the China proxy, or through the one out of China. */
export type Route = 'direct' | 'proxy' | 'global'
export const asRoute = (r?: string | null): Route => (r === 'proxy' || r === 'global' ? r : 'direct')
const LANGUAGES = ['zh-CN']

export class PluginError extends Error {
  constructor(public code: string | undefined, message: string) {
    super(message)
  }
}

export function versionNumbers(v: string): number[] | undefined {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : undefined
}

export function isNewer(a: string, b: string) {
  const x = versionNumbers(a)
  const y = versionNumbers(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

export interface Loaded {
  manifest: Manifest
  dir: string
  code: string
  locales: Record<string, Record<string, string>>
  exports: string[]
  error?: string
}

type Listener = (userId: string, pluginId: string, event: Record<string, unknown>) => void

interface Running {
  worker: Worker
  ready: Promise<string[]>
  calls: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  pongs: Map<number, () => void>
}

const here = path.dirname(fileURLToPath(import.meta.url))
const fromSource = import.meta.url.endsWith('.ts')
const workerFile = fromSource ? path.join(here, 'worker.ts') : path.join(here, 'plugin-worker.js')

export class Plugins {
  readonly dir: string
  readonly dataDir: string
  readonly stagingDir: string
  private loaded = new Map<string, Loaded>()
  private running = new Map<string, Running>()
  private nextCall = 1
  private listeners = new Set<Listener>()

  constructor(private db: DB) {
    this.dir = path.join(config.dataDir, 'plugins')
    this.dataDir = path.join(config.dataDir, 'plugin-data')
    this.stagingDir = path.join(config.dataDir, 'staging')
    for (const d of [this.dir, this.dataDir, this.stagingDir]) fs.mkdirSync(d, { recursive: true })
  }

  onEvent(fn: Listener) {
    this.listeners.add(fn)
  }

  /** Loads every plugin in the plugins folder, as the app does as it opens. */
  async discover() {
    for (const e of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      await this.load(e.name).catch((err) => console.error(`plugin ${e.name}: ${err.message}`))
    }
  }

  list(): Loaded[] {
    return [...this.loaded.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
  }

  get(id: string): Loaded | undefined {
    return this.loaded.get(id)
  }

  /** Reads, checks and bundles the plugin in dir, then starts it to learn what it exports. */
  async load(id: string): Promise<Loaded> {
    const dir = path.join(this.dir, id)
    const loaded = await readPlugin(dir)
    this.ensureRow(id, loaded.manifest)
    // The one loaded before stays listed until this one knows what it
    // exports: listed meanwhile, it would show as doing nothing.
    const before = this.loaded.get(id)
    this.stop(id)
    const entry: Loaded = before
      ? { ...loaded, exports: before.exports, error: before.error }
      : { ...loaded, error: 'Starting…' }
    this.loaded.set(id, entry)
    try {
      const exports = await this.start(id).ready
      Object.assign(entry, { exports, error: undefined })
    } catch (e) {
      Object.assign(entry, { exports: [], error: (e as Error).message })
    }
    return entry
  }

  private ensureRow(id: string, m: Manifest) {
    this.db
      .prepare(
        `INSERT INTO plugins (id, version, installed_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET version = excluded.version`,
      )
      .run(id, m.version ?? '', Date.now())
  }

  route(id: string): Route {
    const row = this.db.prepare(`SELECT route FROM plugins WHERE id = ?`).get(id) as { route: string } | undefined
    return asRoute(row?.route)
  }

  globallyEnabled(id: string): boolean {
    const row = this.db.prepare(`SELECT enabled FROM plugins WHERE id = ?`).get(id) as { enabled: number } | undefined
    return row ? row.enabled === 1 : true
  }

  proxyFor(id: string): string {
    const r = this.route(id)
    return r === 'proxy' ? config.cnProxyUrl : r === 'global' ? config.globalProxyUrl : ''
  }

  dispatcherFor(id: string) {
    const url = this.proxyFor(id)
    return url ? new ProxyAgent({ uri: url }) : undefined
  }

  private start(id: string): Running {
    const l = this.loaded.get(id)!
    const init: WorkerInit = {
      pluginId: id,
      dir: l.dir,
      code: l.code,
      manifest: l.manifest,
      locales: l.locales,
      dataDir: config.dataDir,
      pluginDataDir: path.join(this.dataDir, id),
      proxyUrl: this.proxyFor(id),
      signInTimeout: config.signInTimeout,
    }
    const worker = new Worker(workerFile, {
      workerData: init,
      execArgv: fromSource ? ['--import', 'tsx'] : [],
      resourceLimits: { maxOldGenerationSizeMb: config.memoryLimitMb },
      env: {},
    })
    const calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    const pongs = new Map<number, () => void>()
    let readyResolve!: (v: string[]) => void
    let readyReject!: (e: Error) => void
    const ready = new Promise<string[]>((res, rej) => ((readyResolve = res), (readyReject = rej)))
    ready.catch(() => {})
    const r: Running = { worker, ready, calls, pongs }
    worker.on('message', (m: FromWorker) => {
      switch (m.type) {
        case 'ready':
          readyResolve(m.exports)
          break
        case 'failed':
          readyReject(new Error(m.message))
          break
        case 'result': {
          const c = calls.get(m.id)
          if (!c) break
          calls.delete(m.id)
          if (m.error) c.reject(new PluginError(m.error.code, m.error.message))
          else c.resolve(m.json == null ? null : JSON.parse(m.json))
          break
        }
        case 'event':
          for (const fn of this.listeners) fn(m.userId, id, m.event)
          break
        case 'pong':
          pongs.get(m.n)?.()
          pongs.delete(m.n)
          break
        case 'log':
          console.log(`plugin ${id}: ${m.text}`)
          break
      }
    })
    const fail = (err: Error) => {
      readyReject(err)
      for (const c of calls.values()) c.reject(new PluginError(undefined, 'The plugin stopped; try again'))
      calls.clear()
      if (this.running.get(id) === r) this.running.delete(id)
    }
    worker.on('error', (err) => {
      console.error(`plugin ${id}: ${err.message}`)
      fail(err)
    })
    worker.on('exit', () => fail(new Error('The plugin stopped')))
    this.running.set(id, r)
    return r
  }

  stop(id: string) {
    const r = this.running.get(id)
    this.running.delete(id)
    void r?.worker.terminate()
  }

  /** Forgets what a listener's context of a plugin holds, as after signing out. */
  forget(id: string, userId: string) {
    this.running.get(id)?.worker.postMessage({ type: 'forget', userId } satisfies ToWorker)
  }

  answer(id: string, reqId: string, value?: unknown, error?: string) {
    this.running.get(id)?.worker.postMessage({ type: 'answer', reqId, value, error } satisfies ToWorker)
  }

  /** Calls a function the plugin exports, for a listener. */
  async call(id: string, userId: string, method: string, params: unknown, timeout = config.callTimeout): Promise<unknown> {
    const l = this.loaded.get(id)
    if (!l) throw new PluginError(undefined, `No plugin ${id}`)
    if (l.error) throw new PluginError(undefined, l.error)
    if (!l.exports.includes(method)) throw new PluginError('unsupported', 'not supported by this source')
    let r = this.running.get(id)
    if (!r) {
      r = this.start(id)
      l.exports = await r.ready
    }
    await r.ready
    const n = this.nextCall++
    const running = r
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        running.calls.delete(n)
        reject(new PluginError(undefined, `The plugin didn't answer ${method} in time`))
        // A plugin that doesn't answer a ping either is stuck in its own
        // code, rather than waiting on something: start it again.
        const pn = n
        const t = setTimeout(() => {
          running.pongs.delete(pn)
          console.warn(`plugin ${id}: stuck, restarting`)
          if (this.running.get(id) === running) this.stop(id)
        }, 1000)
        running.pongs.set(pn, () => clearTimeout(t))
        running.worker.postMessage({ type: 'ping', n: pn } satisfies ToWorker)
      }, timeout)
      running.calls.set(n, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      })
      running.worker.postMessage({
        type: 'call',
        id: n,
        userId,
        method,
        params: params === undefined ? null : JSON.stringify(params),
      } satisfies ToWorker)
    })
  }

  // ---- Installing ----

  /** Downloads a plugin to look at before installing it: from a GitHub repository, or an address of a zip. */
  async preview(source: string): Promise<PluginPreview> {
    const { zip, repo, ref, version } = await this.download(source.trim())
    return this.stage(zip, repo, ref, version)
  }

  stageZip(zip: Uint8Array): Promise<PluginPreview> {
    return this.stage(zip)
  }

  private async stage(zip: Uint8Array, repo?: string, ref?: string, version?: string): Promise<PluginPreview> {
    const stagingId = crypto.randomUUID()
    const dir = path.join(this.stagingDir, stagingId)
    extractPlugin(zip, dir)
    const loaded = await readPlugin(dir)
    fs.writeFileSync(path.join(dir, '.origin.json'), JSON.stringify({ repo, ref, version }))
    const m = loaded.manifest
    return { stagingId, manifest: m, replaces: this.loaded.has(m.id) ? this.loaded.get(m.id)!.manifest.version : undefined, version }
  }

  /** Installs what preview staged, in place of the plugin of its id if there is one. */
  async install(stagingId: string): Promise<AdminPlugin> {
    if (!/^[0-9a-f-]{36}$/.test(stagingId)) throw new Error('No such download')
    const dir = path.join(this.stagingDir, stagingId)
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as Manifest
    const origin = JSON.parse(fs.readFileSync(path.join(dir, '.origin.json'), 'utf8')) as { repo?: string; ref?: string }
    const target = path.join(this.dir, m.id)
    this.stop(m.id)
    fs.rmSync(target, { recursive: true, force: true })
    fs.renameSync(dir, target)
    this.db
      .prepare(
        `INSERT INTO plugins (id, repo, version, ref, installed_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET repo = excluded.repo, version = excluded.version, ref = excluded.ref, installed_at = excluded.installed_at`,
      )
      .run(m.id, origin.repo ?? null, m.version ?? '', origin.ref ?? null, Date.now())
    await this.load(m.id)
    return this.admin().find((p) => p.id === m.id)!
  }

  remove(id: string) {
    if (!pluginName.test(id)) throw new Error('No such plugin')
    this.stop(id)
    this.loaded.delete(id)
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true })
    fs.rmSync(path.join(this.dataDir, id), { recursive: true, force: true })
    for (const t of ['plugins', 'user_plugins', 'plugin_settings', 'plugin_storage'])
      this.db.prepare(`DELETE FROM ${t} WHERE ${t === 'plugins' ? 'id' : 'plugin_id'} = ?`).run(id)
  }

  async setRoute(id: string, route: Route) {
    this.db.prepare(`UPDATE plugins SET route = ? WHERE id = ?`).run(route, id)
    if (this.loaded.has(id)) await this.load(id)
  }

  setEnabled(id: string, enabled: boolean) {
    this.db.prepare(`UPDATE plugins SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id)
  }

  admin(): AdminPlugin[] {
    const rows = this.db.prepare(`SELECT * FROM plugins`).all() as {
      id: string
      repo: string | null
      route: string
      enabled: number
      installed_at: number
    }[]
    return this.list().map((l) => {
      const row = rows.find((r) => r.id === l.manifest.id)
      return {
        id: l.manifest.id,
        name: l.manifest.name,
        version: l.manifest.version,
        repo: row?.repo ?? undefined,
        route: asRoute(row?.route),
        enabled: row ? row.enabled === 1 : true,
        network: l.manifest.permissions?.network ?? [],
        error: l.error,
        installedAt: row?.installed_at ?? 0,
      }
    })
  }

  /** The newest version of an installed plugin's repository, if newer than it. */
  async checkUpdate(id: string): Promise<string | undefined> {
    const row = this.db.prepare(`SELECT repo, ref, version FROM plugins WHERE id = ?`).get(id) as
      | { repo: string | null; ref: string | null; version: string | null }
      | undefined
    if (!row?.repo) return undefined
    const latest = await latestOf(row.repo)
    if (latest.ref && latest.ref !== row.ref) return latest.version ?? latest.ref.slice(0, 7)
    return undefined
  }

  private async download(source: string) {
    const gh = githubRepo(source)
    if (gh) {
      const latest = await latestOf(gh)
      // A release's asset answers its file to octet-stream; a zipball, which
      // a repository without releases gives, turns that down (415).
      const res = await github(latest.zipUrl, latest.zipUrl.includes('/releases/assets/'))
      if (!res.ok) throw new Error(`Downloading the plugin failed: HTTP ${res.status}`)
      return { zip: new Uint8Array(await res.arrayBuffer()), repo: gh, ref: latest.ref, version: latest.version }
    }
    const u = new URL(source)
    if (u.protocol !== 'https:') throw new Error('Give a GitHub repository, or an https address of a zip')
    const res = await undiciFetch(u.href, { dispatcher: githubDispatcher() })
    if (!res.ok) throw new Error(`Downloading failed: HTTP ${res.status}`)
    const zip = new Uint8Array(await res.arrayBuffer())
    // Every zip begins "PK"; a web page given in its place says so plainly.
    if (zip[0] !== 0x50 || zip[1] !== 0x4b)
      throw new Error('该地址下载到的不是 zip（可能是网页）。请填 GitHub 仓库地址，或插件 Releases 里 .zip 文件的下载链接')
    return { zip, repo: undefined, ref: undefined, version: undefined }
  }
}

// ---- Reading a plugin's folder ----

async function readPlugin(dir: string): Promise<Loaded> {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')) as Manifest
  if (!m.id || !pluginName.test(m.id)) throw new Error(`a plugin can't be called ${JSON.stringify(m.id)}`)
  m.name ||= m.id
  m.playback ||= 'stream'
  m.main ||= 'index.js'
  if (m.minAppVersion) {
    if (!versionNumbers(m.minAppVersion)) throw new Error(`minAppVersion isn't a version such as 0.1.8: ${m.minAppVersion}`)
    if (isNewer(m.minAppVersion, COMPAT_VERSION))
      throw new Error(`${m.name} needs MyGo Music ${m.minAppVersion} or later`)
  }
  const main = path.resolve(dir, m.main)
  if (!main.startsWith(path.resolve(dir) + path.sep)) throw new Error(`main must be a file in the plugin's folder: ${m.main}`)
  // The plugin is a module: bundled into one script the worker can run,
  // TypeScript and imports of its own files included.
  const out = await build({
    entryPoints: [main],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
    mainFields: ['module', 'main'],
  })
  const code = out.outputFiles[0].text
  const locales: Record<string, Record<string, string>> = {}
  for (const lang of LANGUAGES) {
    const f = path.join(dir, 'locales', `${lang}.json`)
    if (fs.existsSync(f)) locales[lang] = JSON.parse(fs.readFileSync(f, 'utf8'))
  }
  return { manifest: m, dir, code, locales, exports: [] }
}

/** Unpacks a plugin's zip into dir: the folder in it that has plugin.json. */
function extractPlugin(zip: Uint8Array, dir: string) {
  const files = unzipSync(zip)
  const names = Object.keys(files).filter((n) => !n.endsWith('/'))
  const manifests = names.filter((n) => n.endsWith('plugin.json')).sort((a, b) => a.split('/').length - b.split('/').length)
  if (!manifests.length) throw new Error("There's no plugin.json in it")
  const prefix = manifests[0].slice(0, -'plugin.json'.length)
  fs.mkdirSync(dir, { recursive: true })
  for (const n of names) {
    if (!n.startsWith(prefix)) continue
    const rel = n.slice(prefix.length)
    const target = path.resolve(dir, rel)
    if (!target.startsWith(path.resolve(dir) + path.sep)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, files[n])
  }
}

// ---- GitHub ----

function githubRepo(source: string): string | undefined {
  const s = source.replace(/\.git$/, '').replace(/\/$/, '')
  let m = /^(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)/.exec(s)
  if (m) return `${m[1]}/${m[2]}`
  // A mirror in front of it, such as https://gh-proxy.org/https://github.com/owner/repo:
  // the repository is installed through the API, which needs no mirror.
  m = /^https?:\/\/[^/]+\/(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)/.exec(s)
  if (m) return `${m[1]}/${m[2]}`
  m = /^mygo-music:\/\/install-plugin\?repo=([\w.-]+)\/([\w.-]+)/.exec(s)
  if (m) return `${m[1]}/${m[2]}`
  m = /^([\w.-]+)\/([\w.-]+)$/.exec(s)
  if (m) return `${m[1]}/${m[2]}`
  return undefined
}

let githubAgent: ProxyAgent | undefined
const githubDispatcher = () =>
  config.githubProxyUrl ? (githubAgent ??= new ProxyAgent({ uri: config.githubProxyUrl })) : undefined

async function github(url: string, raw = false) {
  const headers = {
    'user-agent': 'antwen-music',
    accept: raw ? 'application/octet-stream' : 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  }
  let res
  try {
    res = await undiciFetch(url, { dispatcher: githubDispatcher(), headers })
  } catch (e) {
    // The proxy isn't running, as a local Clash that's off: go direct.
    if (!config.githubProxyUrl) throw e
    console.warn(`GITHUB_PROXY_URL unreachable (${(e as Error).message}), trying GitHub directly`)
    res = await undiciFetch(url, { headers })
  }
  if (!res.ok && res.status !== 404) throw new Error(`GitHub answered HTTP ${res.status}`)
  return res
}

/**
 * What to install of a repository, as MyGo Music picks it: the latest
 * release's zip named for this platform, else one named for none, else its
 * source; without a release, the default branch's latest commit.
 */
async function latestOf(repo: string): Promise<{ zipUrl: string; ref: string; version?: string }> {
  const rel = await github(`https://api.github.com/repos/${repo}/releases/latest`)
  if (rel.ok) {
    // Assets by their API address, which answers the file to
    // application/octet-stream: github.com's download links are blocked on
    // some networks that let the API through.
    const r = (await rel.json()) as { tag_name: string; zipball_url: string; assets: { name: string; url: string }[] }
    const zips = r.assets.filter((a) => a.name.endsWith('.zip'))
    const platforms = /(darwin|linux|windows|win32)-(arm64|amd64|x64)/
    const mine = zips.find((a) => a.name.includes(`${goos()}-${goarch()}`))
    const any = zips.find((a) => !platforms.test(a.name))
    const asset = mine ?? any
    return { zipUrl: asset?.url ?? r.zipball_url, ref: r.tag_name, version: r.tag_name.replace(/^v/, '') }
  }
  const info = await github(`https://api.github.com/repos/${repo}`)
  if (!info.ok) throw new Error(`There's no repository ${repo} on GitHub`)
  const { default_branch } = (await info.json()) as { default_branch: string }
  const commit = await github(`https://api.github.com/repos/${repo}/commits/${default_branch}`)
  const { sha } = (await commit.json()) as { sha: string }
  return { zipUrl: `https://api.github.com/repos/${repo}/zipball/${sha}`, ref: sha }
}

const goos = () => (process.platform === 'win32' ? 'windows' : process.platform)
const goarch = () => (process.arch === 'x64' ? 'amd64' : process.arch)
