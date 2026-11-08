// A plugin's worker: it runs one plugin, in a context of its own for each
// listener, so that what one keeps never reaches another. This is MyGo Music's
// moejs runtime, in Node: the plugin gets the JavaScript standard library,
// timers, console, fetch to the hosts it asked for, and the host global.

import crypto, { webcrypto } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { parentPort, workerData } from 'node:worker_threads'
import {
  Agent,
  FormData,
  Headers,
  ProxyAgent,
  Request,
  Response,
  fetch as undiciFetch,
  type Dispatcher,
} from 'undici'
import type { Manifest } from '@antwen-music/protocol'
import { openDatabase, pluginSetting, pluginStorageRaw, userLanguage } from '../db.ts'
import { hostAllowed } from './hosts.ts'

export interface WorkerInit {
  pluginId: string
  dir: string
  code: string
  manifest: Manifest
  locales: Record<string, Record<string, string>>
  dataDir: string
  pluginDataDir: string
  proxyUrl: string
  signInTimeout: number
}

export type ToWorker =
  | { type: 'call'; id: number; userId: string; method: string; params: string | null }
  | { type: 'answer'; reqId: string; value?: unknown; error?: string }
  | { type: 'ping'; n: number }
  | { type: 'forget'; userId: string }

export type FromWorker =
  | { type: 'ready'; exports: string[] }
  | { type: 'failed'; message: string }
  | { type: 'result'; id: number; json?: string | null; error?: { code?: string; message: string } }
  | { type: 'event'; userId: string; event: Record<string, unknown> }
  | { type: 'pong'; n: number }
  | { type: 'log'; level: string; text: string }

const init = workerData as WorkerInit
const port = parentPort!
const post = (m: FromWorker) => port.postMessage(m)
const db = openDatabase(init.dataDir)
const network = init.manifest.permissions?.network ?? []

const dispatcher: Dispatcher = init.proxyUrl
  ? new ProxyAgent({ uri: init.proxyUrl })
  : new Agent({ connect: { timeout: 15_000 } })

// fetch, reaching only the hosts the plugin's network permission names,
// redirects included, which it follows itself to check each.
async function pluginFetch(input: unknown, initArg?: Record<string, any>): Promise<Response> {
  if (network.length === 0) throw new TypeError("This plugin didn't ask to reach the network")
  let url: string
  let opts: Record<string, any> = { ...(initArg ?? {}) }
  if (typeof input === 'string') url = input
  else if (input instanceof URL) url = input.href
  else if (input && typeof input === 'object' && 'url' in input) {
    const r = input as Request
    url = r.url
    opts = { method: r.method, headers: r.headers, body: r.body ?? undefined, duplex: 'half', signal: r.signal, ...opts }
  } else url = String(input)
  const mode = opts.redirect ?? 'follow'
  for (let hops = 0; hops <= 20; hops++) {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new TypeError(`fetch can't reach ${u.protocol} addresses`)
    if (!hostAllowed(network, u.hostname)) throw new TypeError(`The plugin can't reach ${u.hostname}`)
    const res = await undiciFetch(url, { ...opts, redirect: 'manual', dispatcher } as any)
    if (mode !== 'follow' || ![301, 302, 303, 307, 308].includes(res.status)) return res
    const location = res.headers.get('location')
    if (!location) return res
    await res.body?.cancel().catch(() => {})
    url = new URL(location, url).href
    const method = String(opts.method ?? 'GET').toUpperCase()
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      opts = { ...opts, method: 'GET', body: undefined }
    }
  }
  throw new TypeError('Too many redirects')
}

function logger(level: string) {
  return (...args: unknown[]) => {
    const text = args
      .map((a) => {
        if (typeof a === 'string') return a
        if (a instanceof Error || (a && typeof a === 'object' && 'stack' in a)) return String((a as Error).stack ?? a)
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
    post({ type: 'log', level, text })
  }
}

function aesEcbEncrypt(key: string, text: string): string {
  const k = Buffer.from(key, 'utf8')
  if (![16, 24, 32].includes(k.length)) throw new Error('An AES key is 16, 24 or 32 bytes')
  const cipher = crypto.createCipheriv(`aes-${k.length * 8}-ecb`, k, null)
  return Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]).toString('hex')
}

// Sign-ins that wait on the listener, by the id the web app answers with.
const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

function askListener(userId: string, event: Record<string, unknown>): Promise<unknown> {
  const reqId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(reqId)
      post({ type: 'event', userId, event: { kind: 'answered', reqId } })
      reject(new Error('Timed out waiting for the sign-in'))
    }, init.signInTimeout)
    waiting.set(reqId, { resolve, reject, timer })
    post({ type: 'event', userId, event: { ...event, reqId } })
  })
}

interface Ctx {
  context: vm.Context
  exports: Record<string, unknown>
  parse: (json: string) => unknown
  timers: Set<NodeJS.Timeout>
}

function makeHost(userId: string, getCtx: () => Ctx) {
  const dataDir = path.join(init.pluginDataDir, safeName(userId))
  const id = init.pluginId
  const upsert = db.prepare(
    `INSERT INTO plugin_storage (user_id, plugin_id, key, value) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = excluded.value`,
  )
  const del = db.prepare(`DELETE FROM plugin_storage WHERE user_id = ? AND plugin_id = ? AND key = ?`)
  const language = () => userLanguage(db, userId)
  return {
    platform: process.platform,
    arch: process.arch,
    dir: init.dir,
    dataDir,
    storage: {
      get(key: unknown) {
        const raw = pluginStorageRaw(db, userId, id, String(key))
        return raw === undefined ? undefined : getCtx().parse(raw)
      },
      set(key: unknown, value: unknown) {
        if (value === undefined) {
          del.run(userId, id, String(key))
          return
        }
        upsert.run(userId, id, String(key), JSON.stringify(value))
      },
      remove(key: unknown) {
        del.run(userId, id, String(key))
      },
    },
    setting: (key: unknown) => pluginSetting(db, userId, id, String(key)),
    language,
    t: (text: unknown) => {
      const s = String(text)
      return init.locales[language()]?.[s] || s
    },
    removeDataDir(name: unknown) {
      const n = String(name)
      const target = path.resolve(dataDir, n)
      if (!target.startsWith(dataDir + path.sep)) throw new Error(`not a folder of the plugin's data: ${n}`)
      fs.rmSync(target, { recursive: true, force: true })
    },
    crypto: {
      md5: (text: unknown) => crypto.createHash('md5').update(String(text), 'utf8').digest('hex'),
      aesEcbEncrypt: (key: unknown, text: unknown) => aesEcbEncrypt(String(key), String(text)),
    },
    openURL(url: unknown) {
      const u = new URL(String(url))
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`not a web address: ${url}`)
      post({ type: 'event', userId, event: { kind: 'openURL', url: u.href } })
    },
    signInPrompt(prompt: unknown) {
      const p = (prompt ?? {}) as { qr?: unknown; text?: unknown }
      post({
        type: 'event',
        userId,
        event: { kind: 'signInPrompt', prompt: { qr: p.qr ? String(p.qr) : undefined, text: p.text ? String(p.text) : undefined } },
      })
    },
    // The browser sign-in comes back to 127.0.0.1 on the listener's own
    // computer, which isn't the server: the web app asks them for the address
    // it went to, and answers its query.
    async waitForRedirect(options: unknown) {
      if (network.length === 0) throw new Error('waitForRedirect needs the network permission')
      const o = (options ?? {}) as { port?: number; path?: string }
      const query = await askListener(userId, { kind: 'waitForRedirect', port: Number(o.port) || 0, path: String(o.path ?? '') })
      return getCtx().parse(JSON.stringify(query))
    },
    // The service's own page can't be shown here to watch its cookies: the
    // web app has the listener sign in there and paste the cookies back.
    async webSignIn(options: unknown) {
      const o = (options ?? {}) as { url?: string; cookiesOf?: string; until?: string[] }
      const u = new URL(String(o.url))
      const of = new URL(String(o.cookiesOf))
      if (u.protocol !== 'https:') throw new Error(`not a secure web address to sign in on: ${o.url}`)
      if (!hostAllowed(network, of.hostname)) throw new Error(`the plugin can't reach ${of.hostname}, so it can't have its cookies`)
      const until = Array.isArray(o.until) ? o.until.map(String) : []
      if (until.length === 0) throw new Error("webSignIn needs the names of the cookies that say it's done, as until")
      const cookie = await askListener(userId, { kind: 'webSignIn', url: u.href, cookiesOf: of.href, until })
      return getCtx().parse(JSON.stringify({ cookie: String(cookie ?? '') }))
    },
    spawn() {
      throw new Error("The web version can't start programs on the server for a plugin")
    },
  }
}

function safeName(s: string) {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_') || '_'
}

const contexts = new Map<string, Ctx>()

function contextFor(userId: string): Ctx {
  let c = contexts.get(userId)
  if (c) return c
  const timers = new Set<NodeJS.Timeout>()
  let made: Ctx | undefined
  const host = makeHost(userId, () => made!)
  const track = (t: NodeJS.Timeout) => (timers.add(t), t)
  const sandbox: Record<string, unknown> = {
    console: { log: logger('log'), info: logger('info'), warn: logger('warn'), error: logger('error'), debug: logger('debug') },
    fetch: pluginFetch,
    Request,
    Response,
    Headers,
    FormData,
    Blob,
    File,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    ReadableStream,
    setTimeout: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const t: NodeJS.Timeout = setTimeout(() => (timers.delete(t), fn(...args)), ms)
      return track(t)
    },
    clearTimeout: (t: NodeJS.Timeout) => (timers.delete(t), clearTimeout(t)),
    setInterval: (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => track(setInterval(fn, ms, ...args)),
    clearInterval: (t: NodeJS.Timeout) => (timers.delete(t), clearInterval(t)),
    queueMicrotask,
    atob,
    btoa,
    structuredClone,
    crypto: {
      getRandomValues: (a: ArrayBufferView) => webcrypto.getRandomValues(a as any),
      randomUUID: () => crypto.randomUUID(),
      subtle: webcrypto.subtle,
    },
    performance: { now: () => performance.now(), timeOrigin: performance.timeOrigin },
    host,
  }
  const context = vm.createContext(sandbox, { name: `${init.pluginId}:${userId}` })
  const parse = vm.runInContext('JSON.parse', context) as (s: string) => unknown
  const wrapper = vm.runInContext(`(function (module, exports) {${init.code}\n})`, context, {
    filename: path.join(init.dir, init.manifest.main ?? 'index.js'),
  }) as (m: unknown, e: unknown) => void
  const mod = vm.runInContext('({ exports: {} })', context) as { exports: Record<string, unknown> }
  wrapper(mod, mod.exports)
  made = { context, exports: mod.exports, parse, timers }
  contexts.set(userId, made)
  return made
}

function errorOf(e: unknown): { code?: string; message: string } {
  if (e && typeof e === 'object') {
    const err = e as { code?: unknown; message?: unknown }
    return { code: err.code != null ? String(err.code) : undefined, message: String(err.message ?? e) }
  }
  return { message: String(e) }
}

async function call(m: Extract<ToWorker, { type: 'call' }>) {
  try {
    const c = contextFor(m.userId)
    const fn = c.exports[m.method]
    if (typeof fn !== 'function') {
      post({ type: 'result', id: m.id, error: { code: 'unsupported', message: 'not supported by this source' } })
      return
    }
    const arg = m.params == null ? undefined : c.parse(m.params)
    const value = await (fn as (a: unknown) => unknown)(arg)
    post({ type: 'result', id: m.id, json: value === undefined ? null : JSON.stringify(value) })
  } catch (e) {
    post({ type: 'result', id: m.id, error: errorOf(e) })
  }
}

port.on('message', (m: ToWorker) => {
  switch (m.type) {
    case 'call':
      void call(m)
      break
    case 'answer': {
      const w = waiting.get(m.reqId)
      if (!w) break
      waiting.delete(m.reqId)
      clearTimeout(w.timer)
      if (m.error) w.reject(new Error(m.error))
      else w.resolve(m.value)
      break
    }
    case 'ping':
      post({ type: 'pong', n: m.n })
      break
    case 'forget': {
      const c = contexts.get(m.userId)
      if (c) for (const t of c.timers) clearTimeout(t)
      contexts.delete(m.userId)
      break
    }
  }
})

// Starting: run the module once to learn what it exports.
try {
  const probe = contextFor('__probe__')
  const names = Object.keys(probe.exports).filter((k) => typeof probe.exports[k] === 'function')
  post({ type: 'ready', exports: names })
} catch (e) {
  post({ type: 'failed', message: errorOf(e).message })
}
