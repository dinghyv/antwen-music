import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { AlbumPage, ArtistPage, Playlist, SearchKind, SearchResult } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { T, Tf, songs } from '../lib/i18n.ts'
import { can, useApp, useSource } from '../store/app.ts'
import { AlbumCard, ArtistCard, PlaylistCard, ShowCard } from '../components/cards.tsx'
import { CardsSkeleton, Empty, Failed, HeroSkeleton, ListSkeleton, Page, useCall, useSrc } from '../components/page.tsx'
import { ArtistLinks, TrackList } from '../components/tracks.tsx'
import { AskText, Confirm, IconButton, Menu, Pill, Popover, Segmented, SectionTitle, Heading, Spinner } from '../components/ui.tsx'
import { ImgFill, PlayButtons } from './home.tsx'

export function AlbumPageView() {
  const src = useSrc()
  const source = useSource(src)
  const id = decodeURIComponent(useParams().id ?? '')
  const q = useCall<AlbumPage>('album', { id }, { stale: 10 * 60_000 })
  const [saved, setSaved] = useState<boolean | null>(null)
  if (q.isPending) return <Page><HeroSkeleton /></Page>
  if (q.error) return <Page><Failed error={q.error} retry={() => q.refetch()} /></Page>
  const { album, tracks = [] } = q.data!
  const isSaved = saved ?? !!album.saved
  return (
    <Page>
      <div className="pad">
        <div className="hero">
          <div className="art" style={{ position: 'relative' }}>
            <ImgFill source={src} url={album.imageUrl} />
          </div>
          <div className="info">
            <div className="kind">{T('Album')}</div>
            <h1>{album.name}</h1>
            <div className="meta one">
              <ArtistLinks artists={album.artists} source={src} />
              {[album.released, songs(tracks.length)].filter(Boolean).map((x) => ` · ${x}`)}
            </div>
            <div className="buttons">
              <PlayButtons tracks={tracks} />
              {can(source, 'saveAlbum') && (
                <Pill
                  icon={isSaved ? 'check' : 'plus'}
                  label={isSaved ? T('Saved') : T('Save')}
                  onClick={async () => {
                    setSaved(!isSaved)
                    try {
                      await call(src, 'saveAlbum', { id, on: !isSaved })
                    } catch (e) {
                      setSaved(isSaved)
                      useApp.getState().say(errorMessage(e))
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <TrackList tracks={tracks} album={false} />
      </div>
    </Page>
  )
}

export function ArtistPageView() {
  const src = useSrc()
  const source = useSource(src)
  const id = decodeURIComponent(useParams().id ?? '')
  const q = useCall<ArtistPage>('artist', { id }, { stale: 10 * 60_000 })
  const [tab, setTab] = useState<'songs' | 'albums'>('songs')
  const [following, setFollowing] = useState<boolean | null>(null)
  if (q.isPending) return <Page><HeroSkeleton round /></Page>
  if (q.error) return <Page><Failed error={q.error} retry={() => q.refetch()} /></Page>
  const { artist, tracks = [], albums = [] } = q.data!
  const follows = following ?? !!artist.following
  const meta = [tracks.length ? songs(tracks.length) : '', albums.length ? Tf('%d albums', albums.length) : ''].filter(Boolean).join(' · ')
  return (
    <Page>
      <div className="pad">
        <div className="hero" style={{ paddingBottom: 34 }}>
          <div className="art round" style={{ position: 'relative' }}>
            <ImgFill source={src} url={artist.imageUrl} />
          </div>
          <div className="info">
            <div className="kind">{T('Artist')}</div>
            <h1>{artist.name}</h1>
            <div className="meta">{meta}</div>
            <div className="buttons">
              <PlayButtons tracks={tracks} />
              {can(source, 'followArtist') && (
                <Pill
                  icon={follows ? 'check' : 'plus'}
                  label={follows ? T('Following') : T('Follow')}
                  onClick={async () => {
                    setFollowing(!follows)
                    try {
                      await call(src, 'followArtist', { id, on: !follows })
                    } catch (e) {
                      setFollowing(follows)
                      useApp.getState().say(errorMessage(e))
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
        <SectionTitle
          title={tab === 'songs' ? T('Songs') : T('Albums')}
          first
          right={
            tracks.length > 0 && albums.length > 0 ? (
              <Segmented value={tab} onChange={setTab} options={[{ value: 'songs', label: T('Songs') }, { value: 'albums', label: T('Albums') }]} />
            ) : undefined
          }
        />
        {tab === 'songs' && tracks.length > 0 ? (
          <TrackList tracks={tracks} />
        ) : (
          <div className="cards">
            {albums.map((a) => (
              <AlbumCard key={a.id} source={src} album={a} />
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

export function PlaylistPageView() {
  const src = useSrc()
  const source = useSource(src)
  const id = decodeURIComponent(useParams().id ?? '')
  const q = useCall<Playlist>('playlist', { id }, { stale: 30_000 })
  const qc = useQueryClient()
  const nav = useNavigate()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [ask, setAsk] = useState<'rename' | 'delete' | null>(null)
  const [saved, setSaved] = useState<boolean | null>(null)
  if (q.isPending) return <Page><HeroSkeleton /></Page>
  if (q.error) return <Page><Failed error={q.error} retry={() => q.refetch()} /></Page>
  const pl = q.data!
  const tracks = pl.tracks ?? []
  const meta = [pl.owner, songs(pl.trackCount || tracks.length)].filter(Boolean).join(' · ')
  const isSaved = saved ?? !!pl.saved
  const refresh = () => {
    void q.refetch()
    void qc.invalidateQueries({ queryKey: [src, 'playlists', null] })
  }
  const editable = pl.mine && !pl.fixed
  return (
    <Page>
      <div className="pad">
        <div className="hero">
          <div className="art" style={{ position: 'relative' }}>
            <ImgFill source={src} url={pl.imageUrl} />
          </div>
          <div className="info">
            <div className="kind">{T('Playlist')}</div>
            <h1>{pl.name}</h1>
            <div className="meta one">{meta}</div>
            {pl.description && <div className="desc two">{pl.description.replaceAll('\n', ' ')}</div>}
            <div className="buttons">
              <PlayButtons tracks={tracks} />
              {!pl.mine && can(source, 'savePlaylist') && (
                <Pill
                  icon={isSaved ? 'check' : 'plus'}
                  label={isSaved ? T('Saved') : T('Save')}
                  onClick={async () => {
                    setSaved(!isSaved)
                    try {
                      await call(src, 'savePlaylist', { id, on: !isSaved })
                      void qc.invalidateQueries({ queryKey: [src, 'playlists', null] })
                    } catch (e) {
                      setSaved(isSaved)
                      useApp.getState().say(errorMessage(e))
                    }
                  }}
                />
              )}
              {editable && (can(source, 'renamePlaylist') || can(source, 'deletePlaylist')) && (
                <IconButton icon="more" size={18} label={T('More')} onClick={(e) => setMenu(e.currentTarget as HTMLElement)} />
              )}
            </div>
          </div>
        </div>
        {tracks.length ? (
          <TrackList tracks={tracks} covers playlist={pl} onRemoved={refresh} />
        ) : (
          <div className="muted" style={{ padding: '12px', fontSize: 'calc(13px * var(--fs))' }}>
            {T('No songs yet')}
          </div>
        )}
      </div>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} className="menu">
          <Menu
            onClose={() => setMenu(null)}
            items={[
              ...(can(source, 'renamePlaylist') ? [{ label: T('Rename…'), icon: 'playlist' as const, onClick: () => setAsk('rename') }] : []),
              ...(can(source, 'deletePlaylist') ? [{ label: T('Delete…'), icon: 'trash' as const, onClick: () => setAsk('delete') }] : []),
            ]}
          />
        </Popover>
      )}
      {ask === 'rename' && (
        <AskText
          title={T('Rename Playlist')}
          initial={pl.name}
          action={T('Rename')}
          onDone={async (name) => {
            setAsk(null)
            if (!name) return
            try {
              await call(src, 'renamePlaylist', { id, name })
              refresh()
            } catch (e) {
              useApp.getState().say(errorMessage(e))
            }
          }}
        />
      )}
      {ask === 'delete' && (
        <Confirm
          title={Tf('Delete “%s”?', pl.name)}
          action={T('Delete')}
          onDone={async (ok) => {
            setAsk(null)
            if (!ok) return
            try {
              await call(src, 'deletePlaylist', { id })
              void qc.invalidateQueries({ queryKey: [src, 'playlists', null] })
              nav(`/${src}`)
            } catch (e) {
              useApp.getState().say(errorMessage(e))
            }
          }}
        />
      )}
    </Page>
  )
}

const KINDS: SearchKind[] = ['tracks', 'artists', 'albums', 'playlists', 'shows']
const kindLabel: Record<SearchKind, string> = { tracks: 'Songs', artists: 'Artists', albums: 'Albums', playlists: 'Playlists', shows: 'Podcasts' }

export function SearchPage() {
  const src = useSrc()
  const source = useSource(src)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const kind = (params.get('kind') as SearchKind) || 'tracks'
  const q = useInfiniteQuery({
    queryKey: [src, 'search', query, kind],
    queryFn: async ({ pageParam }) => call<SearchResult>(src, 'search', { query, kind, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last?.more ? pages.reduce((n, p) => n + countOf(p, kind), 0) : undefined),
    enabled: !!query && can(source, 'search'),
    staleTime: 5 * 60_000,
  })
  const pages = q.data?.pages ?? []
  const all = <K extends keyof SearchResult>(k: K) => pages.flatMap((p) => (p?.[k] as unknown[]) ?? []) as NonNullable<SearchResult[K]>
  const n = pages.reduce((s, p) => s + countOf(p, kind), 0)
  const label = T(kindLabel[kind])
  const sub = q.isSuccess ? `${T('Search')} · ${kind === 'tracks' ? songs(n) : `${n} ${label}`}` : T('Search')
  const more = () => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()
  return (
    <Page onEnd={more}>
      <div className="pad">
        <Heading title={`“${query}”`} sub={sub} />
        <div style={{ marginTop: -6, marginBottom: 14 }}>
          <Segmented
            value={kind}
            onChange={(k) => setParams({ q: query, kind: k }, { replace: true })}
            options={KINDS.map((k) => ({ value: k, label: T(kindLabel[k]) }))}
          />
        </div>
        {q.isPending ? (
          kind === 'tracks' ? <ListSkeleton /> : <CardsSkeleton round={kind === 'artists'} />
        ) : q.error ? (
          <Failed error={q.error} retry={() => q.refetch()} />
        ) : n === 0 ? (
          <Empty icon="search" title={T('No Results')} text={Tf('Nothing found for “%s”', query)} />
        ) : kind === 'tracks' ? (
          <TrackList tracks={all('tracks')} covers />
        ) : (
          <div className="cards">
            {kind === 'albums' && all('albums').map((a) => <AlbumCard key={a.id} source={src} album={a} />)}
            {kind === 'artists' && all('artists').map((a) => <ArtistCard key={a.id} source={src} artist={a} />)}
            {kind === 'playlists' && all('playlists').map((p) => <PlaylistCard key={p.id} source={src} playlist={p} />)}
            {kind === 'shows' && all('shows').map((s) => <ShowCard key={s.id} source={src} show={s} />)}
          </div>
        )}
        {q.isFetchingNextPage && (
          <div className="more-row">
            <Spinner />
          </div>
        )}
      </div>
    </Page>
  )
}

function countOf(p: SearchResult | undefined, kind: SearchKind) {
  return ((p?.[kind] as unknown[] | undefined) ?? []).length
}
