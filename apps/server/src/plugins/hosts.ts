import net from 'node:net'

/**
 * Whether a host is one of patterns, as a plugin's network permission names
 * them: a host, *.example.com for those below it, or * for any.
 */
export function hostAllowed(patterns: string[], host: string): boolean {
  host = host.toLowerCase().replace(/^\[|\]$/g, '')
  for (const raw of patterns) {
    const p = raw.toLowerCase().trim()
    if (p === '*') return !isPrivateHost(host)
    if (p.startsWith('*.')) {
      if (host.endsWith(p.slice(1))) return true
      continue
    }
    if (p === host) return true
  }
  return false
}

/**
 * Hosts of this machine and its network, which a plugin that may reach any
 * host still doesn't: on a server, they'd be the server's own services.
 * A plugin that names one reaches it.
 */
export function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))
    return true
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number)
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (net.isIPv6(host)) {
    const h = host.toLowerCase()
    return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') ||
      h.startsWith('::ffff:')
  }
  return false
}
