import { useState } from 'react'
import { useParams } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { AlbumList, Page as TrackPage, Show, ShowPage, Station } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { T, Tf, songs, PT } from '../lib/i18n.ts'
import { Icon } from '../lib/icons.tsx'
import { useImage } from '../lib/image.ts'
import { can, useApp, useSource } from '../store/app.ts'
import { usePlayer } from '../store/player.ts'
import { AlbumCard, ShowCard, StationCard } from '../components/cards.tsx'
import { CardsSkeleton, Empty, Failed, HeroSkeleton, ListSkeleton, Page, useCall, useSrc } from '../components/page.tsx'
import { TrackList } from '../components/tracks.tsx'
import { Heading, Pill, Segmented, Spinner } from '../components/ui.tsx'
import { ImgFill, PlayButtons } from './home.tsx'

/** A title the source gives one of the app's pages, or the app's own. */
export function useBuiltinTitle(name: string, fallback: string) {
  const src = useSrc()
  const source = useSource(src)
  const n = source?.navigation.find((x) => x.builtin === name && x.title)
  return n?.title ? PT(source?.locales, n.title) : T(fallback)
}

function useOffsetPages<P>(method: 'liked' | 'savedAlbums', size: (p: P) => number) {
  const src = useSrc()
  const source = useSource(src)
  return useInfiniteQuery({
    queryKey: [src, method, 'pages'],
    queryFn: ({ pageParam }) => call<P>(src, method, { offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => ((last as { more?: boolean })?.more ? pages.reduce((n, p) => n + size(p), 0) : undefined),
    enabled: can(source, method),
    staleTime: 30_000,
  })
}

export function LikedPage() {
  const title = useBuiltinTitle('liked', 'Liked Songs')
  const q = useOffsetPages<TrackPage>('liked', (p) => p?.tracks?.length ?? 0)
  const tracks = (q.data?.pages ?? []).flatMap((p) => p?.tracks ?? [])
  return (
    <Page onEnd={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}>
      <div className="pad">
        <div className="hero">
          <div className="art" style={{ display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg, oklch(0.7 0.18 20), var(--accent) 55%, oklch(0.45 0.18 15))' }}>
            <Icon name="heartFill" size={84} />
          </div>
          <div className="info">
            <div className="kind">{T('Playlist')}</div>
            <h1>{title}</h1>
            {q.isSuccess && <div className="meta">{songs(tracks.length)}{q.hasNextPage ? '+' : ''}</div>}
            {tracks.length > 0 && (
              <div className="buttons">
                <PlayButtons tracks={tracks} />
              </div>
            )}
          </div>
        </div>
        {q.isPending ? <ListSkeleton /> : q.error ? <Failed error={q.error} retry={() => q.refetch()} /> : <TrackList tracks={tracks} covers />}
        {q.isSuccess && !tracks.length && <Empty icon="heart" title={T('No liked songs yet')} />}
        {q.isFetchingNextPage && <div className="more-row"><Spinner /></div>}
      </div>
    </Page>
  )
}

export function SavedAlbumsPage() {
  const src = useSrc()
  const title = useBuiltinTitle('savedAlbums', 'Saved Albums')
  const q = useOffsetPages<AlbumList>('savedAlbums', (p) => p?.albums?.length ?? 0)
  const albums = (q.data?.pages ?? []).flatMap((p) => p?.albums ?? [])
  return (
    <Page onEnd={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}>
      <div className="pad">
        <Heading title={title} />
        {q.isPending ? (
          <CardsSkeleton n={10} />
        ) : q.error ? (
          <Failed error={q.error} retry={() => q.refetch()} />
        ) : albums.length ? (
          <div className="cards">
            {albums.map((a) => (
              <AlbumCard key={a.id} source={src} album={a} />
            ))}
          </div>
        ) : (
          <Empty icon="album" title={T('No saved albums yet')} />
        )}
      </div>
    </Page>
  )
}

/** Up to four stations show as a switch over one card, and more as a grid. */
export function StationsPage() {
  const src = useSrc()
  const title = useBuiltinTitle('stations', 'Radio')
  const q = useCall<Station[]>('stations')
  const [at, setAt] = useState(0)
  const stations = q.data ?? []
  return (
    <Page>
      <div className="pad">
        <Heading title={title} />
        {q.isPending ? (
          <CardsSkeleton n={4} />
        ) : q.error ? (
          <Failed error={q.error} retry={() => q.refetch()} />
        ) : !stations.length ? (
          <Empty icon="radio" title={T('No stations')} />
        ) : stations.length <= 4 ? (
          <>
            {stations.length > 1 && (
              <div style={{ marginBottom: 18 }}>
                <Segmented value={at} onChange={setAt} options={stations.map((s, i) => ({ value: i, label: s.name }))} />
              </div>
            )}
            <StationHero source={src} station={stations[Math.min(at, stations.length - 1)]} />
          </>
        ) : (
          <div className="cards">
            {stations.map((s) => (
              <StationCard key={s.id} source={src} station={s} />
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

function StationHero({ source, station }: { source: string; station: Station }) {
  const radio = usePlayer((s) => s.radio)
  const playing = usePlayer((s) => s.playing)
  const on = radio?.source === source && radio.id === station.id
  const img = useImage(source, station.imageUrl, 400)
  return (
    <div
      style={{
        position: 'relative', borderRadius: 24, overflow: 'hidden', minHeight: 260, color: '#fff', padding: 32,
        display: 'flex', alignItems: 'flex-end', background: 'linear-gradient(135deg, oklch(0.45 0.16 20), oklch(0.28 0.1 290))',
        boxShadow: '0 14px 34px -14px var(--card-shade)',
      }}
    >
      {img && <div style={{ position: 'absolute', inset: -40, backgroundImage: `url("${img}")`, backgroundSize: 'cover', filter: 'blur(30px) saturate(1.3)', opacity: 0.55 }} />}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,.45), transparent 70%)' }} />
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="radio" size={14} />
          {T('Radio')}
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8 }}>{station.name}</div>
        {station.description && <div style={{ fontSize: 13.5, opacity: 0.8, lineHeight: 1.45 }}>{station.description}</div>}
        <div style={{ marginTop: 10 }}>
          <button
            className="daily-btn white"
            onClick={() => (on ? usePlayer.getState().toggle() : usePlayer.getState().playStation(source, station.id, station.name))}
          >
            <Icon name={on && playing ? 'pause' : 'play'} size={14} />
            {on && playing ? T('Pause') : T('Play')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ShowsPage() {
  const src = useSrc()
  const title = useBuiltinTitle('shows', 'Podcasts')
  const q = useCall<Show[]>('shows')
  return (
    <Page>
      <div className="pad">
        <Heading title={title} />
        {q.isPending ? (
          <CardsSkeleton />
        ) : q.error ? (
          <Failed error={q.error} retry={() => q.refetch()} />
        ) : q.data?.length ? (
          <div className="cards">
            {q.data.map((s) => (
              <ShowCard key={s.id} source={src} show={s} />
            ))}
          </div>
        ) : (
          <Empty icon="podcast" title={T('No podcasts yet')} />
        )}
      </div>
    </Page>
  )
}

export function ShowPageView() {
  const src = useSrc()
  const source = useSource(src)
  const id = decodeURIComponent(useParams().id ?? '')
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const q = useInfiniteQuery({
    queryKey: [src, 'show', id],
    queryFn: ({ pageParam }) => call<ShowPage>(src, 'show', { id, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last?.more ? pages.reduce((n, p) => n + (p?.episodes?.length ?? 0), 0) : undefined),
    enabled: can(source, 'show'),
    staleTime: 5 * 60_000,
  })
  if (q.isPending) return <Page><HeroSkeleton /></Page>
  if (q.error) return <Page><Failed error={q.error} retry={() => q.refetch()} /></Page>
  const show = q.data!.pages[0].show
  const episodes = q.data!.pages.flatMap((p) => p?.episodes ?? [])
  const on = subscribed ?? !!show.subscribed
  return (
    <Page onEnd={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}>
      <div className="pad">
        <div className="hero">
          <div className="art" style={{ position: 'relative' }}>
            <ImgFill source={src} url={show.imageUrl} />
          </div>
          <div className="info">
            <div className="kind">{T('Podcast')}</div>
            <h1>{show.name}</h1>
            <div className="meta one">{[show.publisher, show.episodeCount ? Tf('%d episodes', show.episodeCount) : ''].filter(Boolean).join(' · ')}</div>
            {show.description && <div className="desc two">{show.description}</div>}
            <div className="buttons">
              <Pill icon="play" label={T('Play')} accent onClick={() => usePlayer.getState().playQueue(episodes)} disabled={!episodes.length} />
              {can(source, 'subscribeShow') && (
                <Pill
                  icon={on ? 'check' : 'plus'}
                  label={on ? T('Subscribed') : T('Subscribe')}
                  onClick={async () => {
                    setSubscribed(!on)
                    try {
                      await call(src, 'subscribeShow', { id, on: !on })
                    } catch (e) {
                      setSubscribed(on)
                      useApp.getState().say(errorMessage(e))
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <TrackList tracks={episodes} episodes numbers={false} />
        {q.isFetchingNextPage && <div className="more-row"><Spinner /></div>}
      </div>
    </Page>
  )
}
