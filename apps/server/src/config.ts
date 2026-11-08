import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// apps/server/src or apps/server/dist: the repository is three up.
const root = path.resolve(here, '../../..')

// The repository's .env, however the server was started (pnpm dev, pnpm start,
// pm2, a debugger). What the environment already has wins over it.
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

const env = process.env
const list = (v?: string) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export const config = {
  root,
  port: Number(env.PORT || 5175),
  host: env.HOST || '127.0.0.1',
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 5175}`).replace(/\/$/, ''),
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  webDist: path.resolve(root, 'apps/web/dist'),
  authMode: (env.AUTH_MODE === 'oidc' ? 'oidc' : 'none') as 'oidc' | 'none',
  oidc: {
    issuer: (env.OIDC_ISSUER || '').replace(/\/$/, ''),
    clientId: env.OIDC_CLIENT_ID || '',
    clientSecret: env.OIDC_CLIENT_SECRET || '',
    scopes: env.OIDC_SCOPES || 'openid profile email',
  },
  allowedUsers: list(env.ALLOWED_USERS),
  adminUsers: list(env.ADMIN_USERS),
  /** Admins of the main site (is_admin, from its trusted clients) are admins here too. */
  siteAdmins: env.OIDC_SITE_ADMINS !== '0',
  /** Optional: a proxy in China for plugins set to go through it. Without one, every plugin goes direct. */
  cnProxyUrl: env.CN_PROXY_URL || '',
  /** Optional: a proxy out of China, for plugins set to go through it, as Spotify from a computer in China. */
  globalProxyUrl: env.GLOBAL_PROXY_URL || '',
  /** Optional: a proxy for reaching GitHub when installing plugins, such as a local Clash at http://127.0.0.1:7890. */
  githubProxyUrl: env.GITHUB_PROXY_URL || '',
  /** Plugins installed on the first start, by their GitHub repositories. */
  defaultPlugins: list(env.DEFAULT_PLUGINS),
  /** How long a call into a plugin may take, and signing in. */
  callTimeout: 30_000,
  signInTimeout: 5 * 60_000,
  /** What a plugin's worker may keep, in megabytes. */
  memoryLimitMb: 256,
}

export const secure = config.publicUrl.startsWith('https://')

// Without sign-in, anyone who reaches the server is an admin: keep it to this
// machine unless told otherwise.
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host)
if (config.authMode === 'none' && !loopback && env.ALLOW_OPEN_ACCESS !== '1') {
  console.error(
    `AUTH_MODE=none only listens on this machine (HOST=127.0.0.1). ` +
      `To serve ${config.host} without sign-in anyway, set ALLOW_OPEN_ACCESS=1.`,
  )
  process.exit(1)
}
if (config.authMode === 'oidc' && (!config.oidc.issuer || !config.oidc.clientId)) {
  console.error('AUTH_MODE=oidc needs OIDC_ISSUER and OIDC_CLIENT_ID in .env')
  process.exit(1)
}
