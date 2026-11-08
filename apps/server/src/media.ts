// Pictures and audio that the browser can't fetch itself: those a plugin's
// requestHeaders put behind its session, a stream that answered headers, and
// plain http addresses a secure page can't play.

import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { request } from 'undici'
import type { Stream } from '@antwen-music/protocol'
import { pluginSetting, pluginStorageRaw, type DB } from './db.ts'
import { hostAllowed } from './plugins/hosts.ts'
import type { Loaded, Plugins } from './plugins/manager.ts'

type Kind = 'image' | 'audio'

/** Whether a requestHeaders host names u's: a host, *.domain, or {setting:key}. */
function hostMatches(pattern: string, u: URL, db: DB, userId: string, pluginId: string) {
  const m = /^\{setting:([^}]+)\}$/.exec(pattern)
  if (m) {
    const value = pluginSetting(db, userId, pluginId, m[1])
    try {
      return !!value && new URL(value).host === u.host
    } catch {
      return false
    }
  }
  return hostAllowed([pattern], u.hostname)
}

function fill(value: string, db: DB, userId: string, pluginId: string): string | undefined {
  let missing = false
  const out = value.replace(/\{(setting|storage):([^}]+)\}/g, (_, kind: string, key: string) => {
    let v = ''
    if (kind === 'setting') v = pluginSetting(db, userId, pluginId, key)
    else {
      const raw = pluginStorageRaw(db, userId, pluginId, key)
      if (raw !== undefined) {
        const parsed = JSON.parse(raw)
        v = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
      }
    }
    if (!v) missing = true
    return v
  })
  return missing ? undefined : out
}

/** The headers a plugin's requestHeaders send with what it fetches of kind at u. */
export function headersFor(l: Loaded, db: DB, userId: string, u: URL, kind: Kind): Record<string, string> {
  const out: Record<string, string> = {}
  const network = l.manifest.permissions?.network ?? []
  if (!hostAllowed(network, u.hostname) && !(l.manifest.requestHeaders ?? []).some((r) => r.hosts.some((h) => h.startsWith('{setting:'))))
    return out
  for (const rh of l.manifest.requestHeaders ?? []) {
    if (rh.kinds && !rh.kinds.includes(kind)) continue
    if (!rh.hosts.some((h) => hostMatches(h, u, db, userId, l.manifest.id))) continue
    for (const [k, v] of Object.entries(rh.headers)) {
      const value = fill(v, db, userId, l.manifest.id)
      if (value !== undefined && !(k.toLowerCase() in lower(out))) out[k] = value
    }
  }
  return out
}

const lower = (h: Record<string, string>) => Object.fromEntries(Object.keys(h).map((k) => [k.toLowerCase(), true]))

/** The hosts whose pictures need headers, for the web app to send through the server. */
export function imageHosts(l: Loaded): string[] {
  return (l.manifest.requestHeaders ?? []).filter((r) => !r.kinds || r.kinds.includes('image')).flatMap((r) => r.hosts)
}

interface Ticket {
  userId: string
  pluginId: string
  url: string
  headers: Record<string, string>
  expires: number
}

const tickets = new Map<string, Ticket>()

/** Where the browser plays a stream from: its own address if it can, else the server's. */
export function playUrlFor(l: Loaded, db: DB, userId: string, s: Stream): string {
  const u = new URL(s.url)
  const headers = { ...headersFor(l, db, userId, u, 'audio') }
  for (const [k, v] of Object.entries(s.headers ?? {})) {
    for (const h of Object.keys(headers)) if (h.toLowerCase() === k.toLowerCase()) delete headers[h]
    headers[k] = v
  }
  if (Object.keys(headers).length === 0 && u.protocol === 'https:') return s.url
  const now = Date.now()
  for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k)
  const token = crypto.randomBytes(18).toString('base64url')
  tickets.set(token, { userId, pluginId: l.manifest.id, url: s.url, headers, expires: now + 6 * 3600_000 })
  return `/api/media/s/${token}`
}

const passOn = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

export function registerMedia(app: FastifyInstance, db: DB, plugins: Plugins) {
  async function relay(
    reply: import('fastify').FastifyReply,
    url: string,
    headers: Record<string, string>,
    range: string | undefined,
    pluginId: string,
    cache: boolean,
  ) {
    let target = url
    for (let hops = 0; hops < 5; hops++) {
      const res = await request(target, {
        method: 'GET',
        headers: { 'user-agent': 'Mozilla/5.0 antwen-music', ...headers, ...(range ? { range } : {}) },
        dispatcher: plugins.dispatcherFor(pluginId),
        maxRedirections: 0,
      } as any)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.body.resume()
        const next = new URL(String(res.headers.location), target)
        // Headers don't go on to another host.
        if (next.host !== new URL(target).host) headers = {}
        target = next.href
        continue
      }
      reply.code(res.statusCode)
      for (const h of passOn) {
        const v = res.headers[h]
        if (v != null) reply.header(h, Array.isArray(v) ? v.join(', ') : v)
      }
      reply.header('cache-control', cache ? 'private, max-age=86400' : 'private, no-store')
      return reply.send(Readable.from(res.body))
    }
    return reply.code(508).send()
  }

  app.get('/api/media/s/:token', async (req, reply) => {
    const t = tickets.get((req.params as { token: string }).token)
    if (!t || t.userId !== req.user!.id || t.expires < Date.now()) return reply.code(404).send()
    return relay(reply, t.url, { ...t.headers }, req.headers.range, t.pluginId, false)
  })

  app.get('/api/media/i', async (req, reply) => {
    const q = req.query as { source?: string; url?: string }
    const l = q.source ? plugins.get(q.source) : undefined
    if (!l || !q.url) return reply.code(404).send()
    let u: URL
    try {
      u = new URL(q.url)
    } catch {
      return reply.code(400).send()
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reply.code(400).send()
    // Pictures from anywhere the plugin may reach, or any public host it
    // pointed at: covers often sit on a CDN of their own.
    const network = l.manifest.permissions?.network ?? []
    const named = (l.manifest.requestHeaders ?? []).some((r) => r.hosts.some((h) => hostMatches(h, u, db, req.user!.id, l.manifest.id)))
    if (!named && !hostAllowed(network.length ? [...network, '*'] : ['*'], u.hostname)) return reply.code(403).send()
    return relay(reply, u.href, headersFor(l, db, req.user!.id, u, 'image'), undefined, l.manifest.id, true)
  })
}
