// Now Playing: the song over its cover's colors, with its lyrics, the stage,
// what's up next, the wall of covers and the comments, as MyGo Music's
// ui_nowplaying.go, ui_stage.go and ui_wall.go have them.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Comment, CommentPage, Lyrics, Track } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { ago, clock, count, T } from '../lib/i18n.ts'
import { Icon } from '../lib/icons.tsx'
import { useImage } from '../lib/image.ts'
import { backdropColors, useTint } from '../lib/colors.ts'
import { fromSource, indexAt, isCredit, lang as lyricsLang, type Line } from '../lib/lyrics.ts'
import { can, useApp, useSource } from '../store/app.ts'
import { useMobile } from '../lib/mobile.ts'
import { usePlayer } from '../store/player.ts'
import { DeviceButton, Scrubber, Transport, usePlaybackTime, VolumeSlider } from './PlayerBar.tsx'
import { ArtistLinks, HeartButton, useSongMenu } from './tracks.tsx'
import { IconButton, Img, Menu, Popover, Spinner } from './ui.tsx'

// 'now' is a phone's own: the cover and controls, which beside a pane need a wider window.
type Pane = 'now' | 'lyrics' | 'stage' | 'queue' | 'wall' | 'comments'

export function NowPlaying() {
  const open = usePlayer((s) => s.nowPlaying)
  const tr = usePlayer((s) => s.queue[s.index])
  const stagePref = useApp((s) => s.prefs.lyricsStage)
  const mobile = useMobile()
  const [pane, setPane] = useState<Pane>('lyrics')
  const [pointer, setPointer] = useState(true)
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const swipe = useRef<{ y: number; x: number } | null>(null)
  const source = useSource(tr?.source)
  const tint = useTint(tr?.source, tr?.album?.imageUrl)
  const [top, foot] = backdropColors(tint)

  // The pane to start on, as it opens; not again as the listener picks one.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      const asked = sessionStorage.getItem('npPane') as Pane | null
      sessionStorage.removeItem('npPane')
      if (asked === 'lyrics') setPane(stagePref ? 'stage' : 'lyrics')
      else if (asked) setPane(asked)
      else if (mobile) setPane('now')
    }
    wasOpen.current = open
  }, [open, stagePref, mobile])

  useEffect(() => {
    if (pane === 'now' && !mobile) setPane('lyrics')
  }, [pane, mobile])

  useEffect(() => {
    if (pane === 'comments' && !can(source, 'comments')) setPane('queue')
  }, [pane, source])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && usePlayer.getState().nowPlaying) usePlayer.getState().openNowPlaying(false)
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  const choose = (p: Pane) => {
    setPane(p)
    if (p === 'lyrics' || p === 'stage') useApp.getState().setPrefs({ lyricsStage: p === 'stage' })
  }
  const tabs: [Pane, string][] = [
    ...(mobile ? [['now', T('Now Playing')] as [Pane, string]] : []),
    ['lyrics', T('Lyrics')],
    ['stage', T('Stage')],
    ['queue', T('Up Next')],
    ['wall', T('Wall')],
  ]
  if (can(source, 'comments')) tabs.push(['comments', T('Comments')])
  const full = pane === 'stage' || pane === 'wall' || (mobile && pane !== 'now')
  const shown = pointer || mobile

  return (
    <div
      className={`np dark-ui ${open ? 'open' : ''} ${mobile ? 'phone' : ''}`}
      aria-hidden={!open}
      // A swipe down the cover's view closes it, as on a phone's own player.
      onTouchStart={(e) => {
        const t = e.touches[0]
        swipe.current = mobile && (pane === 'now' || t.clientY < 90) ? { y: t.clientY, x: t.clientX } : null
      }}
      onTouchEnd={(e) => {
        const s = swipe.current
        const t = e.changedTouches[0]
        if (s && t.clientY - s.y > 110 && Math.abs(t.clientX - s.x) < 80) usePlayer.getState().openNowPlaying(false)
        swipe.current = null
      }}
      onMouseMove={() => {
        setPointer(true)
        clearTimeout(idle.current)
        idle.current = setTimeout(() => full && setPointer(false), 3000)
      }}
      onMouseLeave={() => setPointer(false)}
    >
      <div className="np-bg" style={{ background: `linear-gradient(180deg, ${top}, ${foot})` }} />
      {open && tr && (
        <>
          <div className={`np-top ${shown ? '' : 'hide'}`}>
            <IconButton icon="down" size={22} label={T('Close')} style={{ color: 'rgba(255,255,255,.7)' }} onClick={() => usePlayer.getState().openNowPlaying(false)} />
          </div>
          <div className={`np-tabs ${shown ? '' : 'hide'}`}>
            {tabs.map(([p, label]) => (
              <button key={p} className={`np-tab ${pane === p ? 'on' : ''}`} onClick={() => choose(p)}>
                {label}
                {p === 'comments' && <CommentCount track={tr} />}
              </button>
            ))}
            {pane === 'stage' && <StageStyleButton />}
          </div>
          {pane === 'stage' ? (
            <Stage track={tr} />
          ) : pane === 'wall' ? (
            <Wall track={tr} />
          ) : mobile ? (
            pane === 'now' ? (
              <div className="np-phone-now">
                <NowSide track={tr} />
              </div>
            ) : (
              <div className="np-phone-pane">
                {pane === 'lyrics' && <LyricsPane track={tr} />}
                {pane === 'queue' && <QueuePane />}
                {pane === 'comments' && <CommentsPane track={tr} />}
              </div>
            )
          ) : (
            <div className="np-main">
              <NowSide track={tr} />
              <div className="np-pane">
                {pane === 'lyrics' && <LyricsPane track={tr} />}
                {pane === 'queue' && <QueuePane />}
                {pane === 'comments' && <CommentsPane track={tr} />}
              </div>
            </div>
          )}
          {full && <StageBar track={tr} shown={shown} />}
        </>
      )}
    </div>
  )
}

function NowSide({ track }: { track: Track }) {
  const t = usePlaybackTime(4)
  const duration = usePlayer((s) => s.duration)
  const stream = usePlayer((s) => s.stream)
  const radio = usePlayer((s) => s.radio)
  const { items, dialog } = useSongMenu()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const lossless = stream && ['flac', 'wav'].includes(stream.type)
  return (
    <div className="np-side">
      <div className="np-cover">
        <Img source={track.source} url={track.album?.imageUrl} px={600} iconSize={80} eager />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '36px 0 18px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {radio && (
            <button className="np-chip" onClick={() => usePlayer.getState().leaveStation()} title={T('Leave Station')}>
              <Icon name="radio" size={12} />
              {radio.name}
              <Icon name="x" size={11} />
            </button>
          )}
          <div className="one" style={{ fontSize: 'calc(22px * var(--fs))', fontWeight: 700, letterSpacing: 'calc(-0.3px + var(--ls))' }}>
            {track.name}
          </div>
          <div className="one" style={{ fontSize: 'calc(15px * var(--fs))', color: 'rgba(255,255,255,.6)' }}>
            <ArtistLinks artists={track.artists} source={track.source} />
            {track.album?.name ? ` — ${track.album.name}` : ''}
          </div>
        </div>
        <HeartButton track={track} size={20} dark />
        <DeviceButton size={20} color="rgba(255,255,255,.8)" />
        <IconButton icon="more" size={20} label={T('More')} style={{ color: 'rgba(255,255,255,.8)' }} onClick={(e) => setMenu(e.currentTarget as HTMLElement)} />
      </div>
      <Scrubber />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 'calc(11px * var(--fs))', color: 'rgba(255,255,255,.5)', marginTop: 2 }}>
        <span className="tnum">{clock(t)}</span>
        {lossless && <span className="np-lossless">{T('Lossless')}</span>}
        <span className="tnum">-{clock(Math.max(0, duration - t))}</span>
      </div>
      <div style={{ margin: '18px 0 22px' }}>
        <Transport size={22} dark />
      </div>
      <div className="np-volume" style={{ display: 'flex', justifyContent: 'center' }}>
        <VolumeSlider />
      </div>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} className="menu">
          <Menu items={items([track])} onClose={() => setMenu(null)} />
        </Popover>
      )}
      {dialog}
    </div>
  )
}

function useLyrics(track: Track) {
  const source = useSource(track.source)
  const q = useQuery({
    queryKey: [track.source, 'lyrics', { id: track.id }],
    queryFn: () => call<Lyrics>(track.source!, 'lyrics', { id: track.id }),
    enabled: can(source, 'lyrics'),
    staleTime: Infinity,
  })
  const lines = useMemo(() => fromSource(q.data), [q.data])
  return { lines, loading: q.isPending && can(source, 'lyrics'), lang: lyricsLang(lines) }
}

/** The light of a word at t: 0 before it's sung, 1 once it has been. */
const lit = (w: { start: number; end: number }, t: number) => Math.max(0, Math.min(1, (t - w.start) / Math.max(1, w.end - w.start)))

function LyricsPane({ track }: { track: Track }) {
  const { lines, loading, lang } = useLyrics(track)
  const t = usePlaybackTime(30)
  const cur = indexAt(lines, t + 150)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [held, setHeld] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (held || !list.current || !box.current) return
    const el = list.current.children[Math.max(0, cur)] as HTMLElement | undefined
    if (!el) return
    setOffset(box.current.clientHeight * 0.32 - el.offsetTop - el.offsetHeight / 2)
  }, [cur, held, lines])
  if (loading) return <div className="np-lyrics-empty"><Spinner /></div>
  if (!lines.length) return <div className="np-lyrics-empty">{T('No lyrics. Enjoy the music.')}</div>
  return (
    <div
      ref={box}
      className="np-lyrics"
      lang={lang}
      onWheel={(e) => {
        setHeld(true)
        setOffset((o) => o - e.deltaY)
        clearTimeout(holdTimer.current)
        holdTimer.current = setTimeout(() => setHeld(false), 2500)
      }}
    >
      <div ref={list} className="np-lines" style={{ transform: `translateY(${offset}px)`, transition: held ? 'none' : undefined }}>
        {lines.map((l, i) => {
          const on = i === cur
          return (
            <button
              key={i}
              className={`np-line ${on ? 'on' : ''}`}
              onClick={() => usePlayer.getState().seek(l.at)}
            >
              <span className="w">{on ? <LitWords line={l} t={t} /> : l.text}</span>
              {l.translation && <span className="tr">{l.translation}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LitWords({ line, t }: { line: Line; t: number }) {
  return (
    <>
      {line.words.map((w, i) => {
        const v = lit(w, t)
        const style: CSSProperties = {
          backgroundImage: `linear-gradient(90deg, #fff ${v * 100}%, rgba(255,255,255,.38) ${v * 100}%)`,
        }
        return (
          <span key={i} className="lit" style={style}>
            {w.text}
          </span>
        )
      })}
    </>
  )
}

/** The stage: a line at a time across the whole view, its words springing in as they're sung. */
function Stage({ track }: { track: Track }) {
  const { lines, loading, lang } = useLyrics(track)
  const style = useApp((s) => s.prefs.stageStyle ?? 'folia')
  const t = usePlaybackTime(60)
  const sung = lines.filter((l) => !isCredit(l.text))
  const cur = indexAt(sung, t + 100)
  const line = sung[cur]
  const next = sung[cur + 1]
  if (loading) return <div className="stage"><Spinner /></div>
  if (!sung.length) return <div className="stage"><div className="stage-none">{T('No lyrics. Enjoy the music.')}</div></div>
  // A break between lines: three dots breathing, filling as the next nears.
  const quiet = !line || (t > line.end + 400 && next && next.at - t > 1500)
  if (quiet) {
    const from = line ? line.end : 0
    const to = next ? next.at : from + 1
    const f = Math.max(0, Math.min(1, (t - from) / Math.max(1, to - from)))
    return (
      <div className="stage">
        <div className="dots">
          {[0, 1, 2].map((i) => (
            <i key={i} style={{ opacity: 0.25 + 0.75 * Math.max(0, Math.min(1, f * 3 - i)) }} />
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className={`stage ${style}`} lang={lang}>
      <div className="stage-line" key={cur}>
        {line.words.map((w, i) => {
          const v = lit(w, t)
          const r = seeded(cur * 31 + i)
          const shown = t >= w.start - 120
          const s: CSSProperties =
            style === 'folia'
              ? { transform: shown ? `translate(${(r - 0.5) * 10}px, ${(seeded(i + cur) - 0.5) * 14}px) rotate(${(r - 0.5) * 6}deg) scale(${1 + 0.08 * v * (1 - v) * 4})` : 'translateY(18px) scale(.7)', opacity: shown ? 0.45 + 0.55 * v : 0 }
              : style === 'tilt'
                ? { transform: shown ? `scale(${1 + 0.12 * v * (1 - v) * 4})` : 'scale(.6)', opacity: shown ? 0.4 + 0.6 * v : 0 }
                : { opacity: shown ? 0.35 + 0.65 * v : 0.15, transform: shown ? 'none' : 'translateY(10px)' }
          return (
            <span key={i} className="sw" style={{ ...s, textShadow: v > 0 && v < 1 ? '0 0 24px rgba(255,255,255,.55)' : undefined }}>
              {w.text}
            </span>
          )
        })}
      </div>
      {line.translation && <div className="stage-tr">{line.translation}</div>}
      {next && <div className="stage-next one">{next.text}</div>}
    </div>
  )
}

function seeded(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function StageStyleButton() {
  const style = useApp((s) => s.prefs.stageStyle ?? 'folia')
  const [el, setEl] = useState<HTMLElement | null>(null)
  const names = { folia: 'Folia', partita: 'Partita', tilt: 'Tilt' } as const
  return (
    <>
      <button className="np-tab" onClick={(e) => setEl(e.currentTarget)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {names[style]}
        <Icon name="down" size={12} />
      </button>
      {el && (
        <Popover anchor={el} onClose={() => setEl(null)} className="menu">
          <Menu
            onClose={() => setEl(null)}
            items={(Object.keys(names) as (keyof typeof names)[]).map((k) => ({
              label: names[k],
              check: k === style,
              onClick: () => useApp.getState().setPrefs({ stageStyle: k }),
            }))}
          />
        </Popover>
      )}
    </>
  )
}

/** The slim bar at the foot of the stage and the wall. */
function StageBar({ track, shown }: { track: Track; shown: boolean }) {
  const t = usePlaybackTime(4)
  const duration = usePlayer((s) => s.duration)
  return (
    <div className={`stage-bar ${shown ? '' : 'hide'}`}>
      <Scrubber />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="np-mini">
            <Img source={track.source} url={track.album?.imageUrl} px={44} iconSize={16} eager />
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="one" style={{ fontSize: 'calc(14px * var(--fs))', fontWeight: 700 }}>
              {track.name}
            </span>
            <ArtistLinks artists={track.artists} source={track.source} className="np-dim" />
          </div>
          <HeartButton track={track} size={16} dark />
        </div>
        <Transport size={16} dark />
        <div style={{ flex: '1 1 0', display: 'flex', justifyContent: 'flex-end', fontSize: 'calc(11.5px * var(--fs))', color: 'rgba(255,255,255,.5)' }} className="tnum np-time">
          {clock(t)} / {clock(duration)}
        </div>
      </div>
    </div>
  )
}

/** The wall: the queue's covers, the song playing large over them. */
function Wall({ track }: { track: Track }) {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = row.current?.children[index] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [index])
  return (
    <div className="wall">
      <div className="wall-now">
        <div className="wall-cover">
          <Img source={track.source} url={track.album?.imageUrl} px={360} iconSize={60} eager />
        </div>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="two" style={{ fontSize: 'calc(28px * var(--fs))', fontWeight: 800, letterSpacing: 'calc(-0.5px + var(--ls))' }}>
            {track.name}
          </div>
          <div className="one" style={{ fontSize: 'calc(15px * var(--fs))', color: 'rgba(255,255,255,.6)' }}>
            <ArtistLinks artists={track.artists} source={track.source} />
          </div>
        </div>
      </div>
      <div className="wall-row" ref={row}>
        {queue.map((t, i) => (
          <button key={`${t.id}-${i}`} className={`wall-item ${i === index ? 'on' : ''}`} onClick={() => usePlayer.getState().jump(i)} title={t.name}>
            <Img source={t.source} url={t.album?.imageUrl} px={90} iconSize={20} eager />
          </button>
        ))}
      </div>
    </div>
  )
}

function QueuePane() {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const radio = usePlayer((s) => s.radio)
  const [drag, setDrag] = useState<number | null>(null)
  const p = usePlayer.getState()
  const upNext = queue.slice(index + 1)
  return (
    <div className="np-queue">
      <div className="np-qhead">
        <span>{T('Now Playing')}</span>
      </div>
      {queue[index] && <QueueRow t={queue[index]} i={index} current />}
      <div className="np-qhead" style={{ marginTop: 18 }}>
        <span>{radio ? radio.name : T('Up Next')}</span>
        {upNext.length > 0 && (
          <button className="np-clear" onClick={() => p.clearUpNext()}>
            {T('Clear')}
          </button>
        )}
      </div>
      {upNext.length === 0 && <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 'calc(13px * var(--fs))', padding: '8px 12px' }}>{T('Nothing up next')}</div>}
      {upNext.map((t, k) => {
        const i = index + 1 + k
        return (
          <div
            key={`${t.id}-${i}`}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag !== null && drag !== i) p.move(drag, i)
              setDrag(null)
            }}
            style={{ opacity: drag === i ? 0.4 : 1 }}
          >
            <QueueRow t={t} i={i} />
          </div>
        )
      })}
    </div>
  )
}

function QueueRow({ t, i, current }: { t: Track; i: number; current?: boolean }) {
  return (
    <div className={`np-qrow ${current ? 'cur' : ''} ${t.unavailable ? 'off' : ''}`} onClick={() => !current && usePlayer.getState().jump(i)}>
      <div className="np-mini" style={{ width: 40, height: 40 }}>
        <Img source={t.source} url={t.album?.imageUrl} px={40} iconSize={14} eager />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="one" style={{ fontSize: 'calc(14px * var(--fs))', fontWeight: 600 }}>
          {t.name}
        </span>
        <ArtistLinks artists={t.artists} source={t.source} className="np-dim" />
      </div>
      <span className="tnum" style={{ fontSize: 'calc(12px * var(--fs))', color: 'rgba(255,255,255,.45)' }}>
        {t.duration ? clock(t.duration) : ''}
      </span>
      {!current && (
        <IconButton
          icon="x"
          size={14}
          label={T('Remove')}
          className="np-x"
          onClick={(e) => {
            e.stopPropagation()
            usePlayer.getState().removeAt(i)
          }}
        />
      )}
    </div>
  )
}

function useComments(track: Track, enabled = true) {
  const source = useSource(track.source)
  return useInfiniteQuery({
    queryKey: [track.source, 'comments', track.id],
    queryFn: ({ pageParam }) => call<CommentPage>(track.source!, 'comments', { trackId: track.id, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last?.more ? pages.reduce((n, p) => n + (p?.comments?.length ?? 0), 0) : undefined),
    enabled: enabled && can(source, 'comments'),
    staleTime: 5 * 60_000,
  })
}

function CommentCount({ track }: { track: Track }) {
  const q = useComments(track)
  const n = q.data?.pages[0]?.total ?? 0
  return n > 0 ? <span style={{ opacity: 0.8 }}> {count(n)}</span> : null
}

function CommentsPane({ track }: { track: Track }) {
  const source = useSource(track.source)
  const q = useComments(track)
  const [text, setText] = useState('')
  const [posted, setPosted] = useState<Comment[]>([])
  const [liked, setLiked] = useState<Record<string, boolean>>({})
  const comments = [...posted, ...(q.data?.pages.flatMap((p) => p?.comments ?? []) ?? [])]
  const post = async () => {
    const v = text.trim()
    if (!v) return
    try {
      const c = await call<Comment>(track.source!, 'postComment', { trackId: track.id, text: v })
      if (c) setPosted((p) => [c, ...p])
      setText('')
    } catch (e) {
      useApp.getState().say(errorMessage(e))
    }
  }
  return (
    <div
      className="np-comments"
      onScroll={(e) => {
        const el = e.currentTarget
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
      }}
    >
      {can(source, 'postComment') && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input className="np-input" value={text} placeholder={T('Add a comment…')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && post()} />
          <button className="np-tab on" onClick={post} disabled={!text.trim()}>
            {T('Post')}
          </button>
        </div>
      )}
      {q.isPending && <div style={{ padding: 20, display: 'grid', placeItems: 'center' }}><Spinner /></div>}
      {q.error && <div style={{ color: 'rgba(255,255,255,.6)', padding: 12 }}>{errorMessage(q.error)}</div>}
      {comments.map((c) => {
        const on = liked[c.id] ?? !!c.liked
        const likes = (c.likes ?? 0) + (on && !c.liked ? 1 : !on && c.liked ? -1 : 0)
        return (
          <div className="comment" key={c.id}>
            <span className="avatar">
              <Avatar source={track.source} url={c.avatarUrl} />
            </span>
            <div className="body">
              <div className="who">
                {c.author}
                {c.time ? <span className="faint">{ago(c.time)}</span> : null}
              </div>
              <div className="text">{c.text}</div>
              <button
                className={`likes ${on ? 'on' : ''}`}
                disabled={!can(source, 'likeComment')}
                onClick={async () => {
                  setLiked((l) => ({ ...l, [c.id]: !on }))
                  try {
                    await call(track.source!, 'likeComment', { trackId: track.id, commentId: c.id, on: !on })
                  } catch (e) {
                    setLiked((l) => ({ ...l, [c.id]: on }))
                    useApp.getState().say(errorMessage(e))
                  }
                }}
              >
                <Icon name={on ? 'thumbFill' : 'thumb'} size={13} />
                {likes > 0 ? count(likes) : ''}
              </button>
            </div>
          </div>
        )
      })}
      {q.isFetchingNextPage && <div style={{ padding: 16, display: 'grid', placeItems: 'center' }}><Spinner /></div>}
    </div>
  )
}

function Avatar({ source, url }: { source?: string; url?: string }) {
  const src = useImage(source, url, 34)
  return src ? <img src={src} alt="" loading="lazy" /> : <Icon name="user" size={16} />
}
