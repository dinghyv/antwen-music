// Cards and the pages a source makes up of sections, as MyGo Music's
// ui_browse.go lays them out: a header, then each section's title and its
// songs, or its cards so many to a row.

import { useNavigate } from 'react-router'
import type { Album, AlbumPage, Artist, Browse, Link, Playlist, Section, Show, Station, Track } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { T, songs, today } from '../lib/i18n.ts'
import { Icon, type IconName } from '../lib/icons.tsx'
import { useImage } from '../lib/image.ts'
import { dailyColors, useTint } from '../lib/colors.ts'
import { useApp } from '../store/app.ts'
import { usePlayer } from '../store/player.ts'
import { Img, SectionTitle } from './ui.tsx'
import { TrackList } from './tracks.tsx'

function Card({
  source,
  image,
  name,
  sub,
  round,
  icon,
  onOpen,
  onPlay,
}: {
  source: string
  image?: string
  name: string
  sub?: string
  round?: boolean
  icon: IconName
  onOpen: () => void
  onPlay?: () => void
}) {
  return (
    <div className={`card ${round ? 'round' : ''}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="art">
        <div className="img">
          <Img source={source} url={image} px={200} icon={icon} iconSize={40} round={round} />
        </div>
        {onPlay && !round && (
          <button
            className="play-on"
            aria-label={T('Play')}
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
          >
            <Icon name="play" size={15} style={{ marginLeft: 2 }} />
          </button>
        )}
      </div>
      <div className="name two">{name}</div>
      {sub && <div className="sub one">{sub}</div>}
    </div>
  )
}

const names = (a?: Artist[]) => (a ?? []).map((x) => x.name).join(', ')
const year = (s?: string) => (s ? s.slice(0, 4) : '')

async function playFrom(load: () => Promise<Track[] | undefined>) {
  try {
    const tracks = await load()
    if (tracks?.length) usePlayer.getState().playQueue(tracks)
  } catch (e) {
    useApp.getState().say(errorMessage(e))
  }
}

export function AlbumCard({ source, album }: { source: string; album: Album }) {
  const nav = useNavigate()
  return (
    <Card
      source={source}
      image={album.imageUrl}
      name={album.name}
      sub={[names(album.artists), year(album.released)].filter(Boolean).join(' · ')}
      icon="album"
      onOpen={() => nav(`/${source}/album/${encodeURIComponent(album.id)}`)}
      onPlay={() => playFrom(async () => (await call<AlbumPage>(source, 'album', { id: album.id }))?.tracks)}
    />
  )
}

export function PlaylistCard({ source, playlist }: { source: string; playlist: Playlist }) {
  const nav = useNavigate()
  return (
    <Card
      source={source}
      image={playlist.imageUrl}
      name={playlist.name}
      sub={playlist.owner || (playlist.trackCount ? songs(playlist.trackCount) : undefined)}
      icon="playlist"
      onOpen={() => nav(`/${source}/playlist/${encodeURIComponent(playlist.id)}`)}
      onPlay={() => playFrom(async () => playlist.tracks?.length ? playlist.tracks : (await call<Playlist>(source, 'playlist', { id: playlist.id }))?.tracks)}
    />
  )
}

export function ArtistCard({ source, artist }: { source: string; artist: Artist }) {
  const nav = useNavigate()
  return <Card source={source} image={artist.imageUrl} name={artist.name} round icon="user" onOpen={() => nav(`/${source}/artist/${encodeURIComponent(artist.id)}`)} />
}

export function ShowCard({ source, show }: { source: string; show: Show }) {
  const nav = useNavigate()
  return <Card source={source} image={show.imageUrl} name={show.name} sub={show.publisher} icon="podcast" onOpen={() => nav(`/${source}/show/${encodeURIComponent(show.id)}`)} />
}

export function StationCard({ source, station }: { source: string; station: Station }) {
  const play = () => usePlayer.getState().playStation(source, station.id, station.name)
  return <Card source={source} image={station.imageUrl} name={station.name} sub={station.description} icon="radio" onOpen={play} onPlay={play} />
}

export function LinkCard({ source, link }: { source: string; link: Link }) {
  const nav = useNavigate()
  const src = useImage(source, link.imageUrl, 48)
  return (
    <button className="link-card" onClick={() => nav(`/${source}/browse/${encodeURIComponent(link.page)}`)}>
      {link.imageUrl && <div className="art">{src && <img src={src} alt="" />}</div>}
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span className="one" style={{ fontSize: 'calc(14px * var(--fs))', fontWeight: 600 }}>
          {link.title}
        </span>
        {link.subtitle && <span className="one muted" style={{ fontSize: 'calc(12px * var(--fs))' }}>{link.subtitle}</span>}
      </div>
    </button>
  )
}

/** The cards of a section: a row of them, or as many rows as it has. */
export function SectionCards({ source, sec }: { source: string; sec: Section }) {
  const cards = [
    ...(sec.albums ?? []).map((a) => <AlbumCard key={`al${a.id}`} source={source} album={a} />),
    ...(sec.playlists ?? []).map((p) => <PlaylistCard key={`pl${p.id}`} source={source} playlist={p} />),
    ...(sec.artists ?? []).map((a) => <ArtistCard key={`ar${a.id}`} source={source} artist={a} />),
    ...(sec.shows ?? []).map((s) => <ShowCard key={`sh${s.id}`} source={source} show={s} />),
    ...(sec.stations ?? []).map((s) => <StationCard key={`st${s.id}`} source={source} station={s} />),
  ]
  return (
    <>
      {cards.length > 0 && <div className="cards">{cards}</div>}
      {sec.links?.length ? (
        <div className="cards wide" style={{ marginTop: cards.length ? 20 : 0 }}>
          {sec.links.map((l, i) => (
            <LinkCard key={i} source={source} link={l} />
          ))}
        </div>
      ) : null}
    </>
  )
}

export function sectionIsEmpty(sec: Section) {
  return !(sec.tracks?.length || sec.albums?.length || sec.playlists?.length || sec.artists?.length || sec.shows?.length || sec.stations?.length || sec.links?.length)
}

/** A page a source made up: its sections under a header. The first section of Home, if songs, is the daily card. */
export function BrowseSections({ source, page, pageId, feature }: { source: string; page: Browse; pageId: string; feature?: boolean }) {
  const nav = useNavigate()
  const sections = page.sections ?? []
  return (
    <>
      {sections.map((sec, i) => {
        if (feature && i === 0 && sec.tracks?.length) return <DailyCard key={i} source={source} sec={sec} pageId={pageId} index={i} />
        const more = sec.morePage ? () => nav(`/${source}/browse/${encodeURIComponent(sec.morePage!)}`) : undefined
        const empty = sectionIsEmpty(sec)
        return (
          <div key={i}>
            <SectionTitle title={sec.title} first={i === 0 && !feature && !page.title} onMore={more} />
            {sec.tracks?.length ? <TrackList tracks={sec.tracks} covers album /> : null}
            <SectionCards source={source} sec={sec} />
            {empty && sec.empty && <div className="muted" style={{ fontSize: 'calc(13px * var(--fs))', padding: '4px 0' }}>{sec.empty}</div>}
          </div>
        )
      })}
    </>
  )
}

/** The daily card: the day's songs over their first cover's colors, with a record that turns as they play. */
export function DailyCard({ source, sec, pageId, index }: { source: string; sec: Section; pageId: string; index: number }) {
  const nav = useNavigate()
  const tracks = sec.tracks ?? []
  const first = tracks[0]
  const tint = useTint(source, first?.album?.imageUrl)
  const [deep, rich, glow] = dailyColors(tint)
  const art = useImage(source, first?.album?.imageUrl, 160)
  const cur = usePlayer((s) => s.queue[s.index])
  const playing = usePlayer((s) => s.playing)
  const ours = !!cur && tracks.some((t) => t.id === cur.id && t.source === cur.source)
  const who = [...new Set(tracks.flatMap((t) => (t.artists ?? []).map((a) => a.name)))].slice(0, 4).join('、')
  const open = () => nav(`/${source}/section/${encodeURIComponent(pageId)}/${index}`)
  return (
    <div className="daily" role="button" tabIndex={0} onClick={open} style={{ background: deep }}>
      <div className="bg" style={{ background: `linear-gradient(100deg, ${deep} 10%, ${rich} 85%)` }} />
      {art && <div className="blur" style={{ backgroundImage: `url("${art}")` }} />}
      <div className="bg" style={{ background: `linear-gradient(90deg, ${deep} 0%, transparent 60%)`, opacity: 0.85 }} />
      <div className="bg" style={{ background: `radial-gradient(circle at 78% 50%, ${glow}44, transparent 40%)` }} />
      <div className="sheen" />
      <div className="words">
        <div className="date">{today()}</div>
        <h2 className="two">{sec.title}</h2>
        <div className="who one">{who}</div>
        <div className="acts">
          <button
            className="daily-btn white"
            onClick={(e) => {
              e.stopPropagation()
              if (ours) usePlayer.getState().toggle()
              else usePlayer.getState().playQueue(tracks)
            }}
          >
            <Icon name={ours && playing ? 'pause' : 'play'} size={14} />
            {ours && playing ? T('Pause') : T('Play')}
          </button>
          <button
            className="daily-btn glass"
            onClick={(e) => {
              e.stopPropagation()
              usePlayer.getState().playShuffled(tracks)
            }}
          >
            <Icon name="shuffle" size={14} />
            {T('Shuffle')}
          </button>
        </div>
      </div>
      <div className="picks">
        {tracks.slice(0, 4).map((t, i) => {
          const here = !!cur && cur.id === t.id && cur.source === t.source
          return (
            <button
              key={t.id}
              className="pick"
              onClick={(e) => {
                e.stopPropagation()
                usePlayer.getState().playQueue(tracks, i)
              }}
            >
              <span className="n tnum">{here ? <Icon name="play" size={11} style={{ color: '#fff' }} /> : String(i + 1).padStart(2, '0')}</span>
              <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span className="t one">{t.name}</span>
                <span className="a one">{names(t.artists)}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="stack">
        <div className={`record ${ours && playing ? 'spin' : ''}`} style={{ ['--label' as string]: rich }} />
        {tracks.slice(1, 3).map((t, i) => (
          <StackCover key={t.id} source={source} url={t.album?.imageUrl} left={64 - 30 * (i + 1)} size={136 - 14 * i} z={-i} />
        ))}
        <div className="sleeve">{art && <img src={art} alt="" />}</div>
      </div>
    </div>
  )
}

function StackCover({ source, url, left, size, z }: { source: string; url?: string; left: number; size: number; z: number }) {
  const src = useImage(source, url, 140)
  return (
    <div className="c" style={{ left, top: (156 - size) / 2, width: size, height: size, zIndex: z, opacity: 0.75 }}>
      {src && <img src={src} alt="" />}
    </div>
  )
}

/** The square standing for a day's songs, on their page: the day, over the first cover's colors. */
export function DayArt({ source, url }: { source: string; url?: string }) {
  const tint = useTint(source, url)
  const [deep, rich] = dailyColors(tint)
  return (
    <div className="day-art" style={{ background: `linear-gradient(135deg, ${rich}, ${deep})` }}>
      {new Date().getDate()}
    </div>
  )
}
