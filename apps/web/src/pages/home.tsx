import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { Browse, Playlist, PluginPreview, Track } from '@antwen-music/protocol'
import { api, errorMessage } from '../lib/api.ts'
import { Icon } from '../lib/icons.tsx'
import { greeting, PT, T, Tf, today, songs } from '../lib/i18n.ts'
import { can, useApp, useSource } from '../store/app.ts'
import { usePlayer } from '../store/player.ts'
import { BrowseSections, DayArt, PlaylistCard } from '../components/cards.tsx'
import { Empty, Failed, HeroSkeleton, Page, useCall, useSrc } from '../components/page.tsx'
import { TrackList, usePlaylists } from '../components/tracks.tsx'
import { Heading, Img, Pill, SectionTitle, Sk, Spinner } from '../components/ui.tsx'

export function PlayButtons({ tracks }: { tracks: Track[] }) {
  return (
    <>
      <Pill icon="play" label={T('Play')} accent onClick={() => usePlayer.getState().playQueue(tracks)} disabled={!tracks.length} />
      <Pill icon="shuffle" label={T('Shuffle')} onClick={() => usePlayer.getState().playShuffled(tracks)} disabled={!tracks.length} />
    </>
  )
}

function HomeSkeleton() {
  return (
    <div className="pad">
      <Sk h={212} r={24} style={{ marginBottom: 34 }} />
      <Sk w={120} h={14} style={{ marginBottom: 16 }} />
      <div className="cards">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="card">
            <Sk h="auto" r={10} style={{ aspectRatio: 1 }} />
            <Sk w="80%" h={10} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function HomePage() {
  const src = useSrc()
  const source = useSource(src)
  const account = useApp((s) => s.accounts[src])
  const startSignIn = useApp((s) => s.startSignIn)
  const home = useCall<Browse>('home', undefined, { stale: 30 * 60_000 })
  const recent = useCall<Track[]>('recent', undefined, { enabled: !can(source, 'home') })
  const lists = usePlaylists(src)
  let hello = greeting()
  if (account?.name) hello = Tf('%s, %s', hello, account.name)
  if (!source) return <NoSources />
  const madeUp = can(source, 'home')
  return (
    <Page back={false}>
      <div className="pad">
        <Heading title={hello} sub={today()} />
      </div>
      {madeUp ? (
        home.isPending ? (
          <HomeSkeleton />
        ) : home.error ? (
          <Failed error={home.error} retry={() => home.refetch()} />
        ) : (
          <div className="pad">
            <BrowseSections source={src} page={{ ...home.data!, title: undefined }} pageId="home" feature />
          </div>
        )
      ) : (
        <div className="pad">
          {recent.data?.length ? (
            <>
              <SectionTitle title={T('Recently Played')} first />
              <TrackList tracks={recent.data} covers />
            </>
          ) : null}
          {lists.data?.length ? (
            <>
              <SectionTitle title={T('Playlists')} first={!recent.data?.length} />
              <div className="cards">
                {lists.data.map((p) => (
                  <PlaylistCard key={p.id} source={src} playlist={p} />
                ))}
              </div>
            </>
          ) : null}
          {!recent.data?.length && !lists.data?.length && !recent.isPending && (
            account === null && can(source, 'signIn') ? (
              <Empty icon="user" title={Tf('Sign in to %s', PT(source.locales, source.name))}>
                <button className="pill accent" onClick={() => startSignIn(src)}>
                  {T('Sign In')}
                </button>
              </Empty>
            ) : (
              <Empty icon="note" title={T('Nothing here yet')} text={T('Search for something to play.')} />
            )
          )}
        </div>
      )}
    </Page>
  )
}

const RECOMMENDED = { repo: 'AkinoKaede/mygo-music-netease-cloud-music', name: 'NetEase Cloud Music' }

/** With no plugin yet: one to install at a click, the rest from Settings. */
function NoSources() {
  const { me, openSettings, refreshSources } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The server may be installing its default plugins as this shows.
  useEffect(() => {
    const t = setInterval(() => void refreshSources().catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [refreshSources])
  const install = async () => {
    setBusy(true)
    setError('')
    try {
      const p = await api<PluginPreview>('/api/admin/plugins/preview', { body: { source: RECOMMENDED.repo } })
      await api('/api/admin/plugins/install', { body: { stagingId: p.stagingId } })
      await refreshSources()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page back={false}>
      <Empty icon="plug" title={T('No plugins yet')} text={me?.admin ? T('Install a plugin to start listening.') : T('Ask an admin to install a plugin.')}>
        {me?.admin && (
          <div style={{ display: 'flex', gap: 10, marginTop: 6, alignItems: 'center' }}>
            <button className="pill accent" onClick={install} disabled={busy}>
              {busy ? <Spinner /> : <Icon name="plus" size={14} />}
              {Tf('Install %s', T(RECOMMENDED.name))}
            </button>
            <button className="pill" onClick={() => openSettings('plugins')}>
              {T('Other Plugins…')}
            </button>
          </div>
        )}
        {error && <p style={{ color: 'var(--accent)' }}>{error}</p>}
      </Empty>
    </Page>
  )
}

export function BrowsePage() {
  const src = useSrc()
  const page = decodeURIComponent(useParams().page ?? '')
  const q = useCall<Browse>('browse', { page }, { stale: 5 * 60_000 })
  if (q.isPending) return <Page><HeroSkeleton /></Page>
  if (q.error) return <Page><Failed error={q.error} retry={() => q.refetch()} /></Page>
  const b = q.data!
  const lines = (b.description ?? '').split('\n').filter(Boolean)
  return (
    <Page>
      <div className="pad">
        {b.imageUrl ? (
          <div className="hero" style={{ paddingBottom: 34 }}>
            <div className="art round" style={{ position: 'relative' }}>
              <ImgFill source={src} url={b.imageUrl} />
            </div>
            <div className="info">
              {b.subtitle && <div className="kind">{b.subtitle}</div>}
              <h1>{b.title}</h1>
              {lines.map((l, i) => (
                <div key={i} className="desc two" style={{ fontSize: 'calc(13px * var(--fs))' }}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        ) : (
          (b.title || b.subtitle) && (
            <>
              <Heading title={b.title ?? ''} sub={b.subtitle} />
              {lines.map((l, i) => (
                <div key={i} className="muted two" style={{ fontSize: 'calc(13px * var(--fs))', lineHeight: 1.45, marginTop: -10, marginBottom: 18 }}>
                  {l}
                </div>
              ))}
            </>
          )
        )}
        <BrowseSections source={src} page={b} pageId={page} />
        {!(b.sections ?? []).length && <Empty icon="note" title={T('Nothing here yet')} />}
      </div>
    </Page>
  )
}

export function ImgFill({ source, url, px = 212 }: { source: string; url?: string; px?: number }) {
  return <Img source={source} url={url} px={px} iconSize={64} />
}

/** All the songs of a section the daily card shows a few of. */
export function SectionPage() {
  const src = useSrc()
  const { page = '', index = '0' } = useParams()
  const pageId = decodeURIComponent(page)
  const qc = useQueryClient()
  const home = useCall<Browse>('home', undefined, { enabled: pageId === 'home', stale: 30 * 60_000 })
  const browse = useCall<Browse>('browse', { page: pageId }, { enabled: pageId !== 'home' })
  const data = (pageId === 'home' ? home.data : browse.data) ?? qc.getQueryData<Browse>([src, 'home', null])
  const sec = data?.sections?.[Number(index)]
  if (!sec) return <Page>{home.error || browse.error ? <Failed error={home.error || browse.error} /> : <HeroSkeleton />}</Page>
  const tracks = sec.tracks ?? []
  const title = sec.pageTitle || sec.title || ''
  const about = [songs(tracks.length), sec.subtitle].filter(Boolean).join(' · ')
  return (
    <Page>
      <div className="pad">
        <div className="hero">
          <DayArt source={src} url={tracks[0]?.album?.imageUrl} />
          <div className="info">
            <div className="muted" style={{ fontSize: 'calc(12px * var(--fs))', fontWeight: 600, letterSpacing: 'calc(0.3px + var(--ls))' }}>
              {today()}
            </div>
            <h1>{title}</h1>
            <div className="meta two">{about}</div>
            <div className="buttons">
              <PlayButtons tracks={tracks} />
            </div>
          </div>
        </div>
        <TrackList tracks={tracks} covers />
      </div>
    </Page>
  )
}

export type { Playlist }
