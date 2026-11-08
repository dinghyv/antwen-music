// What every page is: a scroll under a strip with the back button, which
// frosts once content is under it, and what shows while it loads or failed.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { SourceMethod } from '@antwen-music/protocol'
import { call, errorCode, errorMessage } from '../lib/api.ts'
import { T, Tf, PT } from '../lib/i18n.ts'
import { Icon, type IconName } from '../lib/icons.tsx'
import { can, useApp, useSource } from '../store/app.ts'
import { useMobile } from '../lib/mobile.ts'
import { IconButton, Sk } from './ui.tsx'

/** The source of the page open: its id in the address. */
export function useSrc(): string {
  return useParams().src ?? ''
}

/** Asks the page's source for something, kept a while as it's opened again. */
export function useCall<T>(method: SourceMethod, params?: unknown, opts: { enabled?: boolean; stale?: number } = {}): UseQueryResult<T> {
  const src = useSrc()
  const source = useSource(src)
  return useQuery<T>({
    queryKey: [src, method, params ?? null],
    queryFn: () => call<T>(src, method, params),
    enabled: !!source && can(source, method) && opts.enabled !== false,
    staleTime: opts.stale ?? 30_000,
    retry: (n, e) => n < 1 && !errorCode(e),
  })
}

export function Page({ children, onEnd, back = true }: { children: ReactNode; onEnd?: () => void; back?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState(false)
  const nav = useNavigate()
  const mobile = useMobile()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = 0
    const on = () => {
      setEdge(el.scrollTop > 2)
      if (onEnd && el.scrollTop + el.clientHeight > el.scrollHeight - 600) onEnd()
    }
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [onEnd])
  return (
    <>
      <div className={`topbar ${edge ? 'edge' : ''}`}>
        {mobile && <IconButton icon="menu" size={20} label={T('Menu')} onClick={() => useApp.setState({ drawer: true })} />}
        {back && history.length > 1 && <IconButton icon="back" size={mobile ? 20 : 16} label={T('Back')} onClick={() => nav(-1)} />}
        {mobile && (
          <>
            <span style={{ flex: 1 }} />
            <IconButton
              icon="search"
              size={19}
              label={T('Search')}
              style={{ marginRight: 8 }}
              onClick={() => {
                useApp.setState({ drawer: true })
                setTimeout(() => document.getElementById('side-search')?.focus(), 250)
              }}
            />
          </>
        )}
      </div>
      <div className="page" ref={ref}>
        {children}
      </div>
    </>
  )
}

/** In place of what failed to load: what went wrong, and where it can be put right. */
export function Failed({ error, retry }: { error: unknown; retry?: () => void }) {
  const src = useSrc()
  const source = useSource(src)
  const { startSignIn, openSettings } = useApp()
  const code = errorCode(error)
  return (
    <div className="centered">
      <div className="err">{errorMessage(error)}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        {code === 'signIn' && (
          <button className="pill accent" onClick={() => startSignIn(src)}>
            {Tf('Sign in to %s', PT(source?.locales, source?.name ?? ''))}
          </button>
        )}
        {code === 'setup' && (
          <button className="pill accent" onClick={() => openSettings('plugins')}>
            {T('Open Settings')}
          </button>
        )}
        {retry && code !== 'signIn' && code !== 'setup' && (
          <button className="pill" onClick={retry}>
            {T('Try Again')}
          </button>
        )}
      </div>
    </div>
  )
}

export function Empty({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="centered">
      <div className="icon-box">
        <Icon name={icon} size={32} />
      </div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children}
    </div>
  )
}

export function HeroSkeleton({ round }: { round?: boolean }) {
  return (
    <div className="pad">
      <div className="hero">
        <Sk w={212} h={212} r={round ? 106 : 14} />
        <div className="info">
          <Sk w={60} h={12} />
          <Sk w="50%" h={30} />
          <Sk w="35%" h={13} />
        </div>
      </div>
      <ListSkeleton />
    </div>
  )
}

export function ListSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="tracks">
      {Array.from({ length: n }, (_, i) => (
        <div className="track" key={i}>
          <Sk w={26} h={12} />
          <div className="title">
            <Sk w={`${40 + ((i * 17) % 30)}%`} h={13} />
            <Sk w={`${20 + ((i * 11) % 20)}%`} h={11} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function CardsSkeleton({ n = 5, round }: { n?: number; round?: boolean }) {
  return (
    <div className="cards">
      {Array.from({ length: n }, (_, i) => (
        <div className="card" key={i}>
          <Sk h="auto" r={round ? 999 : 10} style={{ aspectRatio: 1 }} />
          <Sk w="80%" h={11} />
          <Sk w="50%" h={10} />
        </div>
      ))}
    </div>
  )
}
