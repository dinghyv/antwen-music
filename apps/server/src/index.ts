import fs from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyReply } from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { fetch as undiciFetch } from 'undici'
import { SOURCE_METHODS, type SourceInfo, type Stream, type PlayableStream } from '@antwen-music/protocol'
import { config } from './config.ts'
import { migrate, migrateColumns, openDatabase } from './db.ts'
import { isAdmin, me, registerAuth } from './auth.ts'
import { imageHosts, playUrlFor, registerMedia } from './media.ts'
import { asRoute, PluginError, Plugins } from './plugins/manager.ts'

const db = openDatabase(config.dataDir)
migrate(db)
migrateColumns(db)
const plugins = new Plugins(db)
await plugins.discover()

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 20 * 1024 * 1024, trustProxy: true })
await app.register(cookie)
registerAuth(app, db)
registerMedia(app, db, plugins)

// ---- What the host tells the listener's browser: QR codes, pages to open, sign-ins to finish ----

const streams = new Map<string, Set<FastifyReply>>()
function emit(userId: string, source: string, event: Record<string, unknown>) {
  const data = `data: ${JSON.stringify({ ...event, source })}\n\n`
  for (const r of streams.get(userId) ?? []) r.raw.write(data)
}

// Sign-ins run here, not in a request: one waits minutes for a scan, and a
// request held that long takes one of the six connections a browser opens to
// a host, until pages stop loading. Each is told to the browser as events,
// and told again to a tab that connects meanwhile, as one coming to the front.
interface SignIn {
  prompt?: Record<string, unknown>
  /** The page it asked to open, offered again as a button rather than opened again. */
  opened?: Record<string, unknown>
  /** Questions the plugin raised while signing in, still unanswered. */
  pending: Record<string, unknown>[]
  end?: Record<string, unknown>
  endedAt?: number
}
const signIns = new Map<string, SignIn>()
const signInKey = (userId: string, source: string) => `${userId}\n${source}`

plugins.onEvent((userId, source, event) => {
  const s = signIns.get(signInKey(userId, source))
  if (s && !s.end) {
    if (event.kind === 'signInPrompt') s.prompt = event
    else if (event.kind === 'openURL') s.opened = event
    else if (event.kind === 'waitForRedirect' || event.kind === 'webSignIn') s.pending.push(event)
    else if (event.kind === 'answered') s.pending = s.pending.filter((p) => p.reqId !== event.reqId)
  }
  emit(userId, source, event)
})

function startSignIn(userId: string, source: string) {
  const key = signInKey(userId, source)
  const running = signIns.get(key)
  if (running && !running.end) {
    // Asked again, as from another tab: the same sign-in, what it showed again.
    if (running.prompt) emit(userId, source, { ...running.prompt, replay: true })
    if (running.opened) emit(userId, source, { ...running.opened, replay: true })
    for (const p of running.pending) emit(userId, source, { ...p, replay: true })
    return
  }
  const s: SignIn = { pending: [] }
  signIns.set(key, s)
  const finish = (end: Record<string, unknown>) => {
    s.end = end
    s.endedAt = Date.now()
    emit(userId, source, end)
    setTimeout(() => signIns.get(key) === s && signIns.delete(key), 2 * 60_000)
  }
  plugins
    .call(source, userId, 'signIn', undefined, config.signInTimeout)
    .then((account) => finish({ kind: 'signedIn', account: account ?? null }))
    .catch((e) =>
      finish({
        kind: 'signInFailed',
        error: { code: e instanceof PluginError ? e.code : undefined, message: (e as Error).message ?? String(e) },
      }),
    )
}

app.get('/api/events', (req, reply) => {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  reply.raw.write(': hello\n\n')
  const id = req.user!.id
  const set = streams.get(id) ?? new Set()
  set.add(reply)
  streams.set(id, set)
  // What went on while this tab wasn't listening.
  for (const [key, s] of signIns) {
    const [userId, source] = key.split('\n')
    if (userId !== id) continue
    const send = (e: Record<string, unknown>) => reply.raw.write(`data: ${JSON.stringify({ ...e, source, replay: true })}\n\n`)
    if (s.end) send(s.end)
    else {
      if (s.prompt) send(s.prompt)
      if (s.opened) send(s.opened)
      for (const p of s.pending) send(p)
    }
  }
  const beat = setInterval(() => reply.raw.write(': beat\n\n'), 25_000)
  req.raw.on('close', () => {
    clearInterval(beat)
    set.delete(reply)
  })
})

// ---- The listener, and what they keep ----

app.get('/api/me', async (req) => me(req.user!))

function getPref(userId: string, key: string) {
  const row = db.prepare(`SELECT value FROM prefs WHERE user_id = ? AND key = ?`).get(userId, key) as { value: string } | undefined
  return row ? JSON.parse(row.value) : {}
}
function setPref(userId: string, key: string, value: unknown) {
  db.prepare(
    `INSERT INTO prefs (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value`,
  ).run(userId, key, JSON.stringify(value ?? {}))
}
for (const key of ['prefs', 'session']) {
  app.get(`/api/${key}`, async (req) => getPref(req.user!.id, key))
  app.put(`/api/${key}`, async (req) => {
    setPref(req.user!.id, key, req.body)
    return { ok: true }
  })
}

// ---- Sources ----

function userEnabled(userId: string, id: string) {
  const row = db.prepare(`SELECT enabled FROM user_plugins WHERE user_id = ? AND plugin_id = ?`).get(userId, id) as
    | { enabled: number }
    | undefined
  return row ? row.enabled === 1 : true
}

app.get('/api/sources', async (req): Promise<SourceInfo[]> => {
  const userId = req.user!.id
  const repos = Object.fromEntries(
    (db.prepare(`SELECT id, repo FROM plugins`).all() as { id: string; repo: string | null }[]).map((r) => [r.id, r.repo]),
  )
  return plugins
    .list()
    .filter((l) => plugins.globallyEnabled(l.manifest.id) && !l.error)
    .map((l) => {
      const m = l.manifest
      const values: Record<string, string> = {}
      for (const r of db
        .prepare(`SELECT key, value FROM plugin_settings WHERE user_id = ? AND plugin_id = ?`)
        .all(userId, m.id) as { key: string; value: string }[])
        values[r.key] = r.value
      return {
        id: m.id,
        name: m.name,
        version: m.version,
        playback: m.playback ?? 'stream',
        settings: m.settings ?? [],
        navigation: m.navigation ?? [],
        caps: l.exports,
        enabled: userEnabled(userId, m.id),
        values,
        imageHosts: imageHosts(l),
        locales: l.locales,
        network: m.permissions?.network ?? [],
        repo: repos[m.id] ?? undefined,
      }
    })
})

app.post('/api/sources/:id/enabled', async (req) => {
  const { id } = req.params as { id: string }
  const { enabled } = req.body as { enabled: boolean }
  db.prepare(
    `INSERT INTO user_plugins (user_id, plugin_id, enabled) VALUES (?, ?, ?)
     ON CONFLICT (user_id, plugin_id) DO UPDATE SET enabled = excluded.enabled`,
  ).run(req.user!.id, id, enabled ? 1 : 0)
  return { ok: true }
})

app.post('/api/sources/:id/settings', async (req, reply) => {
  const { id } = req.params as { id: string }
  const { key, value } = req.body as { key: string; value: string }
  const l = plugins.get(id)
  if (!l) return reply.code(404).send({ error: { message: 'No such plugin' } })
  db.prepare(
    `INSERT INTO plugin_settings (user_id, plugin_id, key, value) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = excluded.value`,
  ).run(req.user!.id, id, key, String(value ?? ''))
  if (l.exports.includes('setSetting')) {
    try {
      await plugins.call(id, req.user!.id, 'setSetting', { key, value })
    } catch (e) {
      return sendError(reply, e)
    }
  }
  return { ok: true }
})

app.post('/api/sources/:id/answer', async (req) => {
  const { id } = req.params as { id: string }
  const { reqId, value, error } = req.body as { reqId: string; value?: unknown; error?: string }
  plugins.answer(id, reqId, value, error)
  const s = signIns.get(signInKey(req.user!.id, id))
  if (s) s.pending = s.pending.filter((p) => p.reqId !== reqId)
  emit(req.user!.id, id, { kind: 'answered', reqId })
  return { ok: true }
})

function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof PluginError) return reply.code(400).send({ error: { code: e.code, message: e.message } })
  console.error(e)
  return reply.code(500).send({ error: { message: (e as Error).message ?? String(e) } })
}

/** Stamps each track with the plugin it came from, as source.go does. */
function stamp(v: unknown, source: string, key = ''): void {
  if (Array.isArray(v)) {
    for (const x of v) {
      if ((key === 'tracks' || key === 'episodes' || key === '') && x && typeof x === 'object' && 'album' in x)
        (x as { source?: string }).source ??= source
      stamp(x, source)
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) stamp(x, source, k)
  }
}

const methods = new Set<string>(SOURCE_METHODS)
app.post('/api/call/:id/:method', async (req, reply) => {
  const { id, method } = req.params as { id: string; method: string }
  if (!methods.has(method)) return reply.code(404).send({ error: { message: `No method ${method}` } })
  const params = (req.body as { params?: unknown } | undefined)?.params
  const userId = req.user!.id
  if (method === 'signIn') {
    if (!plugins.get(id)?.exports.includes('signIn')) return reply.code(400).send({ error: { code: 'unsupported', message: 'not supported by this source' } })
    startSignIn(userId, id)
    return { result: { pending: true } }
  }
  try {
    const result = await plugins.call(id, userId, method, params, config.callTimeout)
    if (method === 'stream' && result) {
      const s = result as Stream
      const out: PlayableStream = { ...s, playUrl: playUrlFor(plugins.get(id)!, db, userId, s) }
      delete out.headers
      return { result: out }
    }
    if (method === 'signOut') plugins.forget(id, userId)
    stamp(result, id)
    return { result }
  } catch (e) {
    return sendError(reply, e)
  }
})

// ---- Admin: installing plugins and how they reach the network ----

app.register(async (admin) => {
  admin.addHook('preHandler', async (req, reply) => {
    if (!req.user || !isAdmin(req.user)) return reply.code(403).send({ error: { message: 'Admins only' } })
  })
  admin.addContentTypeParser(['application/zip', 'application/octet-stream'], { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  )
  admin.get('/api/admin/plugins', async () => ({
    plugins: plugins.admin(),
    proxyConfigured: !!config.cnProxyUrl,
    globalProxyConfigured: !!config.globalProxyUrl,
  }))
  admin.post('/api/admin/plugins/preview', async (req, reply) => {
    try {
      return await plugins.preview((req.body as { source: string }).source)
    } catch (e) {
      return reply.code(400).send({ error: { message: (e as Error).message } })
    }
  })
  admin.post('/api/admin/plugins/upload', async (req, reply) => {
    try {
      return await plugins.stageZip(new Uint8Array(req.body as Buffer))
    } catch (e) {
      return reply.code(400).send({ error: { message: (e as Error).message } })
    }
  })
  admin.post('/api/admin/plugins/install', async (req, reply) => {
    try {
      return await plugins.install((req.body as { stagingId: string }).stagingId)
    } catch (e) {
      return reply.code(400).send({ error: { message: (e as Error).message } })
    }
  })
  admin.delete('/api/admin/plugins/:id', async (req) => {
    plugins.remove((req.params as { id: string }).id)
    return { ok: true }
  })
  admin.put('/api/admin/plugins/:id', async (req) => {
    const { id } = req.params as { id: string }
    const b = req.body as { route?: string; enabled?: boolean }
    if (b.route) await plugins.setRoute(id, asRoute(b.route))
    if (typeof b.enabled === 'boolean') plugins.setEnabled(id, b.enabled)
    return { ok: true }
  })
  admin.post('/api/admin/plugins/:id/reload', async (req, reply) => {
    try {
      await plugins.load((req.params as { id: string }).id)
      return { ok: true }
    } catch (e) {
      return reply.code(400).send({ error: { message: (e as Error).message } })
    }
  })
  admin.get('/api/admin/plugins/:id/update', async (req, reply) => {
    try {
      return { version: (await plugins.checkUpdate((req.params as { id: string }).id)) ?? null }
    } catch (e) {
      return reply.code(400).send({ error: { message: (e as Error).message } })
    }
  })
  // Whether a plugin reaches its first host the way it's set to: direct or through a proxy.
  admin.post('/api/admin/plugins/:id/network-test', async (req, reply) => {
    const { id } = req.params as { id: string }
    const l = plugins.get(id)
    const host = l?.manifest.permissions?.network?.find((h) => h !== '*' && !h.startsWith('*.'))
    if (!host) return reply.code(400).send({ error: { message: 'The plugin names no host to try' } })
    const started = Date.now()
    try {
      const res = await undiciFetch(`https://${host}/`, {
        dispatcher: plugins.dispatcherFor(id),
        signal: AbortSignal.timeout(10_000),
      })
      await res.arrayBuffer()
      const ms = Date.now() - started
      // The address the plugin goes out from, and where it is: services such
      // as NetEase turn away addresses outside China (-460).
      const exit = await undiciFetch('https://myip.ipip.net/', {
        dispatcher: plugins.dispatcherFor(id),
        headers: { 'user-agent': 'curl/8' },
        signal: AbortSignal.timeout(6000),
      })
        .then((r) => r.text())
        .then((t) => t.replace(/\s+/g, ' ').trim().slice(0, 120))
        .catch(() => '')
      return { ok: true, host, status: res.status, ms, exit }
    } catch (e) {
      const err = e as Error & { cause?: Error }
      return reply.code(502).send({ error: { message: `${host}: ${err.cause?.message ?? err.message}` } })
    }
  })
})

// ---- The web app ----

if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, wildcard: false, maxAge: '1h' })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { message: 'Not found' } })
    return reply.type('text/html').header('cache-control', 'no-cache').sendFile('index.html')
  })
} else {
  // Developing: the web app is Vite's, on PUBLIC_URL (localhost:5173), not built here.
  const web = new URL(config.publicUrl)
  const elsewhere = web.port !== String(config.port)
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { message: 'Not found' } })
    if (elsewhere) return reply.redirect(new URL(req.url, web).href)
    return reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(
        `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:40px;line-height:1.6">` +
          `<p>前端还没构建。开发时请打开 <a href="http://localhost:5173">http://localhost:5173</a>（pnpm dev），` +
          `或先运行 <code>pnpm build</code> 再用 <code>pnpm start</code>。</p>`,
      )
  })
}

await app.listen({ port: config.port, host: config.host })
console.log(
  `antwen music on ${config.host}:${config.port} · ${plugins.list().length} plugins · auth ${config.authMode}` +
    (config.cnProxyUrl ? ' · CN proxy set' : ''),
)

// The first start installs DEFAULT_PLUGINS, once: removed later, they stay removed.
const defaultsMark = path.join(config.dataDir, '.default-plugins-installed')
if (config.defaultPlugins.length && !fs.existsSync(defaultsMark)) {
  void (async () => {
    let all = true
    const installed = new Set(
      (db.prepare(`SELECT repo FROM plugins WHERE repo IS NOT NULL`).all() as { repo: string }[]).map((r) => r.repo.toLowerCase()),
    )
    for (const repo of config.defaultPlugins) {
      if (installed.has(repo.toLowerCase())) continue
      try {
        const p = await plugins.preview(repo)
        await plugins.install(p.stagingId)
        console.log(`installed default plugin ${repo}`)
      } catch (e) {
        all = false
        console.warn(`couldn't install default plugin ${repo}: ${(e as Error).message}`)
      }
    }
    // Tried again on the next start if any failed, as with no network.
    if (all) fs.writeFileSync(defaultsMark, config.defaultPlugins.join('\n'))
  })()
}

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    for (const l of plugins.list()) plugins.stop(l.manifest.id)
    void app.close().then(() => process.exit(0))
  })
