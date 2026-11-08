// Lists of songs, as MyGo Music's trackRows: a row of each, playing the
// list from it as it's clicked, with its heart and a menu of what else.

import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Artist, Playlist, Track } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { clock, T, ago } from '../lib/i18n.ts'
import { Icon } from '../lib/icons.tsx'
import { can, useApp, useSource } from '../store/app.ts'
import { isLiked, usePlayer } from '../store/player.ts'
import { AskText, Bars, IconButton, Img, Menu, Popover, type MenuItem } from './ui.tsx'

export function ArtistLinks({ artists, source, className }: { artists?: Artist[]; source?: string; className?: string }) {
  const nav = useNavigate()
  if (!artists?.length) return null
  return (
    <span className={`one ${className ?? ''}`}>
      {artists.map((a, i) => (
        <Fragment key={a.id || i}>
          {i > 0 && ', '}
          {a.id && source ? (
            <span
              className="link"
              onClick={(e) => {
                e.stopPropagation()
                usePlayer.getState().openNowPlaying(false)
                nav(`/${source}/artist/${encodeURIComponent(a.id)}`)
              }}
            >
              {a.name}
            </span>
          ) : (
            a.name
          )}
        </Fragment>
      ))}
    </span>
  )
}

/** The source's playlists, which the sidebar and the menus of songs share. */
export function usePlaylists(source: string | undefined) {
  const src = useSource(source)
  return useQuery<Playlist[]>({
    queryKey: [source, 'playlists', null],
    queryFn: () => call<Playlist[]>(source!, 'playlists'),
    enabled: !!src && can(src, 'playlists') && useApp.getState().accounts[source!] !== null,
    staleTime: 30_000,
  })
}

/** What a song's menu offers. */
export function useSongMenu() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [ask, setAsk] = useState<{ tracks: Track[] } | null>(null)
  const items = (tracks: Track[], ctx: { playlist?: Playlist; onRemoved?: () => void } = {}): MenuItem[] => {
    const t = tracks[0]
    const src = useApp.getState().sources.find((s) => s.id === t.source)
    const p = usePlayer.getState()
    const liked = isLiked(p.liked, t)
    const mine = (qc.getQueryData<Playlist[]>([t.source, 'playlists', null]) ?? []).filter((x) => x.mine && !x.fixed)
    const out: MenuItem[] = [
      { label: T('Play Next'), icon: 'queue', onClick: () => p.playNext(tracks) },
      { label: T('Add to Queue'), icon: 'playlist', onClick: () => p.addToQueue(tracks) },
    ]
    if (can(src, 'addToPlaylist'))
      out.push({
        label: T('Add to Playlist'),
        icon: 'plus',
        sub: [
          ...(can(src, 'createPlaylist') ? [{ label: T('New Playlist') + '…', icon: 'plus' as const, onClick: () => setAsk({ tracks }) }, { sep: true }] : []),
          ...mine.map((pl) => ({
            label: pl.name,
            onClick: async () => {
              try {
                await call(t.source!, 'addToPlaylist', { id: pl.id, trackIds: tracks.map((x) => x.id) })
                useApp.getState().say(`${T('Added to')} ${pl.name}`)
                void qc.invalidateQueries({ queryKey: [t.source, 'playlist', { id: pl.id }] })
                void qc.invalidateQueries({ queryKey: [t.source, 'playlists', null] })
              } catch (e) {
                useApp.getState().say(errorMessage(e))
              }
            },
          })),
        ],
      })
    if (ctx.playlist?.mine && !ctx.playlist.fixed && can(src, 'removeFromPlaylist'))
      out.push({
        label: T('Remove from Playlist'),
        icon: 'trash',
        onClick: async () => {
          try {
            await call(t.source!, 'removeFromPlaylist', { id: ctx.playlist!.id, trackIds: tracks.map((x) => x.id) })
            ctx.onRemoved?.()
          } catch (e) {
            useApp.getState().say(errorMessage(e))
          }
        },
      })
    if (tracks.length === 1 && (can(src, 'like') || (t.showId && can(src, 'likeEpisode'))))
      out.push({ label: liked ? T('Unlike') : T('Like'), icon: liked ? 'heartFill' : 'heart', onClick: () => p.setLiked(t.source!, t.id, !liked, !!t.showId) })
    out.push({ sep: true })
    if (t.album?.id && !t.showId) out.push({ label: T('Go to Album'), icon: 'album', onClick: () => go(`/${t.source}/album/${encodeURIComponent(t.album.id)}`) })
    if (t.showId) out.push({ label: T('Go to Podcast'), icon: 'podcast', onClick: () => go(`/${t.source}/show/${encodeURIComponent(t.showId!)}`) })
    for (const a of (t.artists ?? []).filter((a) => a.id).slice(0, 4))
      out.push({ label: `${T('Go to Artist')}: ${a.name}`, icon: 'user', onClick: () => go(`/${t.source}/artist/${encodeURIComponent(a.id)}`) })
    if (t.url)
      out.push(
        { sep: true },
        {
          label: T('Copy Link'),
          icon: 'more',
          onClick: () => void navigator.clipboard.writeText(t.url!).then(() => useApp.getState().say(T('Copied'))),
        },
        { label: T('Open in Browser'), icon: 'forward', onClick: () => window.open(t.url, '_blank', 'noopener') },
      )
    return out
  }
  const go = (to: string) => {
    usePlayer.getState().openNowPlaying(false)
    nav(to)
  }
  const dialog = ask && (
    <AskText
      title={T('New Playlist')}
      placeholder={T('Playlist Name')}
      action={T('Create')}
      onDone={async (name) => {
        const tracks = ask.tracks
        setAsk(null)
        if (!name) return
        const source = tracks[0].source!
        try {
          const pl = await call<Playlist>(source, 'createPlaylist', { name })
          await call(source, 'addToPlaylist', { id: pl.id, trackIds: tracks.map((x) => x.id) })
          void qc.invalidateQueries({ queryKey: [source, 'playlists', null] })
        } catch (e) {
          useApp.getState().say(errorMessage(e))
        }
      }}
    />
  )
  return { items, dialog }
}

export function HeartButton({ track, size = 16, dark }: { track: Track; size?: number; dark?: boolean }) {
  const src = useSource(track.source)
  const liked = usePlayer((s) => isLiked(s.liked, track))
  const episode = !!track.showId
  if (!(episode ? can(src, 'likeEpisode') : can(src, 'like'))) return null
  return (
    <IconButton
      icon={liked ? 'heartFill' : 'heart'}
      size={size}
      label={liked ? T('Unlike') : T('Like')}
      className={liked ? 'on' : ''}
      style={liked ? { color: dark ? '#fff' : 'var(--accent)' } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        void usePlayer.getState().setLiked(track.source!, track.id, !liked, episode)
      }}
    />
  )
}

export function TrackList({
  tracks,
  covers = false,
  album = true,
  playlist,
  onRemoved,
  numbers = true,
  episodes = false,
}: {
  tracks: Track[]
  covers?: boolean
  album?: boolean
  playlist?: Playlist
  onRemoved?: () => void
  numbers?: boolean
  episodes?: boolean
}) {
  const { items, dialog } = useSongMenu()
  const [menu, setMenu] = useState<{ i: number; at: { x: number; y: number } } | null>(null)
  const cur = usePlayer((s) => s.queue[s.index])
  const playing = usePlayer((s) => s.playing)
  const nav = useNavigate()
  return (
    <div className="tracks">
      {tracks.map((t, i) => {
        const here = !!cur && cur.id === t.id && cur.source === t.source
        return (
          <div
            key={`${t.id}-${i}`}
            className={`track ${here ? 'current' : ''} ${t.unavailable ? 'unavailable' : ''} ${menu?.i === i ? 'menu' : ''}`}
            onClick={() => (here ? usePlayer.getState().toggle() : usePlayer.getState().playQueue(tracks, i))}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ i, at: { x: e.clientX, y: e.clientY } })
            }}
          >
            {numbers && (
              <div className="num tnum">
                {here ? (
                  <Bars paused={!playing} />
                ) : (
                  <>
                    <span className="n">{i + 1}</span>
                    <span className="play">
                      <Icon name="play" size={13} />
                    </span>
                  </>
                )}
              </div>
            )}
            {covers && (
              <div className="cover" style={{ position: 'relative' }}>
                <Img source={t.source} url={t.album?.imageUrl} px={36} iconSize={14} />
              </div>
            )}
            <div className="title">
              <span className="name one">{t.name}</span>
              {episodes ? (
                <span className="artists one">{[t.published && ago(Date.parse(t.published)), t.description].filter(Boolean).join(' · ')}</span>
              ) : (
                <ArtistLinks artists={t.artists} source={t.source} className="artists" />
              )}
            </div>
            {album && !episodes && (
              <div className="album one">
                {t.album?.id ? (
                  <span
                    className="link"
                    onClick={(e) => {
                      e.stopPropagation()
                      nav(`/${t.source}/album/${encodeURIComponent(t.album.id)}`)
                    }}
                  >
                    {t.album.name}
                  </span>
                ) : (
                  t.album?.name
                )}
              </div>
            )}
            <div className="heart">
              <HeartButton track={t} size={16} />
            </div>
            <IconButton
              icon="more"
              size={16}
              label={T('More')}
              className="more"
              onClick={(e) => {
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setMenu({ i, at: { x: r.left - 160, y: r.bottom + 4 } })
              }}
            />
            <div className="dur tnum">{t.duration ? clock(t.duration) : ''}</div>
          </div>
        )
      })}
      {menu && tracks[menu.i] && (
        <Popover at={menu.at} onClose={() => setMenu(null)} className="menu">
          <Menu items={items([tracks[menu.i]], { playlist, onRemoved })} onClose={() => setMenu(null)} />
        </Popover>
      )}
      {dialog}
    </div>
  )
}
