// Pictures as plugins give them: an imageUrl may say where its size goes,
// with {size}, which the app fills in with the pixels it shows it at.

import { useApp } from '../store/app.ts'

export function sized(url: string | undefined, px: number): string | undefined {
  if (!url) return undefined
  const n = String(Math.round(px * Math.min(window.devicePixelRatio || 1, 2)))
  return url.replaceAll('{size}', n).replaceAll('%7Bsize%7D', n).replaceAll('%7bsize%7d', n)
}

function needsServer(url: string, hosts: string[]) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'http:' && location.protocol === 'https:') return true
  return hosts.some((h) => (h.startsWith('*.') ? u.hostname.endsWith(h.slice(1)) : h === u.hostname || h.startsWith('{setting:')))
}

export function viaServer(source: string, url: string) {
  return `/api/media/i?source=${encodeURIComponent(source)}&url=${encodeURIComponent(url)}`
}

/** The address to show a source's picture from, at px across. */
export function useImage(source: string | undefined, url: string | undefined, px: number): string | undefined {
  const hosts = useApp((s) => s.sources.find((x) => x.id === source)?.imageHosts)
  const u = sized(url, px)
  if (!u || !source) return u
  return needsServer(u, hosts ?? []) ? viaServer(source, u) : u
}

export function imageFor(source: string | undefined, url: string | undefined, px: number): string | undefined {
  const u = sized(url, px)
  if (!u || !source) return u
  const hosts = useApp.getState().sources.find((x) => x.id === source)?.imageHosts ?? []
  return needsServer(u, hosts) ? viaServer(source, u) : u
}
