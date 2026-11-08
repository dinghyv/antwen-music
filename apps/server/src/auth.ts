// Signing in with the main site's account (gta-db-next is an OpenID provider),
// and who may come in: the listeners ALLOWED_USERS names.

import crypto from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Me } from '@antwen-music/protocol'
import { config, secure } from './config.ts'
import type { DB } from './db.ts'

const COOKIE = 'am_session'
const SESSION_DAYS = 30
const LOCAL_USER = { id: 'local', name: 'Local', email: null as string | null, avatar: null as string | null }

export interface User {
  id: string
  name: string
  email: string | null
  avatar: string | null
  /** An admin of the main site, as its trusted client tells (is_admin). */
  site_admin?: number
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const b64url = (b: Buffer) => b.toString('base64url')

/** Who may come in: on the list, an admin by the list, or an admin of the main site. */
function allowed(u: User) {
  return matches(config.allowedUsers, u) || matches(config.adminUsers, u) || (config.siteAdmins && u.site_admin === 1)
}

function matches(list: string[], u: { id: string; name?: string | null; email?: string | null }) {
  if (list.includes('*')) return true
  return list.some((x) => x === u.id || (u.name && x === u.name) || (u.email && x.toLowerCase() === u.email.toLowerCase()))
}

export function isAdmin(u: User) {
  return config.authMode === 'none' || matches(config.adminUsers, u) || (config.siteAdmins && u.site_admin === 1)
}

export function me(u: User): Me {
  return { id: u.id, name: u.name, avatar: u.avatar ?? undefined, admin: isAdmin(u), authMode: config.authMode }
}

let discovery: Promise<Record<string, string>> | undefined
function discover() {
  discovery ??= fetch(`${config.oidc.issuer}/.well-known/openid-configuration`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`OIDC discovery answered HTTP ${r.status}`)
      return (await r.json()) as Record<string, string>
    })
    .catch((e) => {
      discovery = undefined
      throw e
    })
  return discovery
}

export function registerAuth(app: FastifyInstance, db: DB) {
  if (config.authMode === 'none') {
    db.prepare(`INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)`).run(
      LOCAL_USER.id,
      LOCAL_USER.name,
      Date.now(),
    )
  }

  const userOf = (req: FastifyRequest): User | undefined => {
    if (config.authMode === 'none') return LOCAL_USER
    const token = req.cookies[COOKIE]
    if (!token) return undefined
    const row = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.avatar, u.site_admin FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), Date.now()) as User | undefined
    // Taken off the list since: out.
    if (row && !allowed(row)) return undefined
    return row
  }

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/')) return
    const u = userOf(req)
    if (!u) return reply.code(401).send({ error: { message: 'Sign in first' } })
    req.user = u
  })

  app.get('/api/auth/login', async (req, reply) => {
    if (config.authMode === 'none') return reply.redirect('/')
    const d = await discover()
    const state = b64url(crypto.randomBytes(24))
    const verifier = b64url(crypto.randomBytes(32))
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
    const returnTo = String((req.query as Record<string, string>).return || '/')
    db.prepare(`DELETE FROM oidc_states WHERE created_at < ?`).run(Date.now() - 10 * 60_000)
    db.prepare(`INSERT INTO oidc_states (state, verifier, return_to, created_at) VALUES (?, ?, ?, ?)`).run(
      state,
      verifier,
      returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/',
      Date.now(),
    )
    const u = new URL(d.authorization_endpoint)
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.oidc.clientId,
      redirect_uri: `${config.publicUrl}/api/auth/callback`,
      scope: config.oidc.scopes,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    return reply.redirect(u.href)
  })

  app.get('/api/auth/callback', async (req, reply) => {
    const q = req.query as Record<string, string>
    if (q.error) return page(reply, 400, `登录失败：${q.error_description || q.error}`)
    const st = db.prepare(`SELECT * FROM oidc_states WHERE state = ?`).get(q.state ?? '') as
      | { verifier: string; return_to: string; created_at: number }
      | undefined
    db.prepare(`DELETE FROM oidc_states WHERE state = ?`).run(q.state ?? '')
    if (!st || Date.now() - st.created_at > 10 * 60_000) return page(reply, 400, '登录已过期，请重新登录。')
    const d = await discover()
    const tokenRes = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: q.code ?? '',
        redirect_uri: `${config.publicUrl}/api/auth/callback`,
        client_id: config.oidc.clientId,
        client_secret: config.oidc.clientSecret,
        code_verifier: st.verifier,
      }),
    })
    if (!tokenRes.ok) return page(reply, 502, `换取令牌失败：HTTP ${tokenRes.status}`)
    const { access_token } = (await tokenRes.json()) as { access_token: string }
    const infoRes = await fetch(d.userinfo_endpoint, { headers: { authorization: `Bearer ${access_token}` } })
    if (!infoRes.ok) return page(reply, 502, `读取用户信息失败：HTTP ${infoRes.status}`)
    const info = (await infoRes.json()) as Record<string, string>
    const user: User = {
      id: String(info.sub),
      name: info.preferred_username || info.name || info.nickname || info.email || String(info.sub),
      email: info.email || null,
      avatar: info.picture || null,
      site_admin: (info as Record<string, unknown>).is_admin === true ? 1 : 0,
    }
    if (!allowed(user)) return page(reply, 403, `账号 ${user.name} 没有使用权限，请联系管理员把你加入白名单。`)
    db.prepare(
      `INSERT INTO users (id, name, email, avatar, site_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email, avatar = excluded.avatar, site_admin = excluded.site_admin`,
    ).run(user.id, user.name, user.email, user.avatar, user.site_admin!, Date.now())
    const token = b64url(crypto.randomBytes(32))
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`).run(
      sha256(token),
      user.id,
      Date.now() + SESSION_DAYS * 86400_000,
    )
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: SESSION_DAYS * 86400,
    })
    return reply.redirect(st.return_to)
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE]
    if (token) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token))
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/status', async (req) => {
    const u = userOf(req)
    return u ? { signedIn: true, me: me(u) } : { signedIn: false, authMode: config.authMode }
  })
}

function page(reply: FastifyReply, code: number, text: string) {
  const html = `<!doctype html><meta charset="utf-8"><title>antwen music</title>
<body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#1d1d1f">
<div style="text-align:center"><p>${text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</p>
<p><a href="/api/auth/login" style="color:#e0334a">重新登录</a></p></div>`
  return reply.code(code).type('text/html; charset=utf-8').send(html)
}
