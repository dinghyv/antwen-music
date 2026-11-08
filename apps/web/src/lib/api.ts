import type { SourceMethod } from '@antwen-music/protocol'

/** What a request failed with: a plugin's code, such as signIn or unavailable, and its message. */
export class ApiError extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; type?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined || init.raw ? 'POST' : 'GET'),
    headers: init.raw ? { 'content-type': init.type ?? 'application/octet-stream' } : init.body !== undefined ? { 'content-type': 'application/json' } : {},
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: 'same-origin',
  })
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    location.href = `/api/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`
    throw new ApiError(401, undefined, 'Sign in first')
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || undefined, data?.error?.message ?? `HTTP ${res.status}`)
  return data as T
}

/** Calls a function a plugin exports. */
export async function call<T>(source: string, method: SourceMethod, params?: unknown): Promise<T> {
  const r = await api<{ result: T }>(`/api/call/${encodeURIComponent(source)}/${method}`, { body: { params } })
  return r.result
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined)
