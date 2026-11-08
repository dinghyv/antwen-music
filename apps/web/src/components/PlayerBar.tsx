// The player along the foot of the pages: what plays, its controls and
// progress, and the volume, as MyGo Music's ui_player.go has it.

import { useEffect, useRef, useState } from 'react'
import type { Device } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { useApp } from '../store/app.ts'
import { clock, T } from '../lib/i18n.ts'
import { useMobile } from '../lib/mobile.ts'
import { Icon, type IconName } from '../lib/icons.tsx'
import { audio, playbackTime, usePlayer } from '../store/player.ts'
import { ArtistLinks, HeartButton } from './tracks.tsx'
import { IconButton, Img, Menu, Popover } from './ui.tsx'

/** Redraws each frame while playing, for what moves with the music. */
export function usePlaybackTime(fps = 60) {
  const playing = usePlayer((s) => s.playing)
  const position = usePlayer((s) => s.position)
  const [t, setT] = useState(position)
  useEffect(() => {
    setT(playbackTime())
    if (!playing) return
    let raf = 0
    let last = 0
    const step = (now: number) => {
      if (now - last >= 1000 / fps) {
        last = now
        setT(playbackTime())
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, position, fps])
  return t
}

/** How far the song is, seeking where it's dragged or clicked. */
export function Scrubber({ height = 16 }: { height?: number }) {
  const t = usePlaybackTime(30)
  const duration = usePlayer((s) => s.duration)
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [buffered, setBuffered] = useState(0)
  useEffect(() => {
    const on = () => {
      const b = audio.buffered
      setBuffered(b.length && audio.duration ? b.end(b.length - 1) / audio.duration : 0)
    }
    audio.addEventListener('progress', on)
    return () => audio.removeEventListener('progress', on)
  }, [])
  const frac = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (x - r.left) / r.width))
  }
  const v = drag ?? (duration ? t / duration : 0)
  return (
    <div
      ref={ref}
      className={`scrub ${drag !== null ? 'drag' : ''}`}
      style={{ height }}
      role="slider"
      aria-label={T('Progress')}
      aria-valuenow={Math.round(t / 1000)}
      onPointerDown={(e) => {
        if (!duration) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag(frac(e.clientX))
      }}
      onPointerMove={(e) => drag !== null && setDrag(frac(e.clientX))}
      onPointerUp={(e) => {
        if (drag === null) return
        usePlayer.getState().seek(frac(e.clientX) * duration)
        setDrag(null)
      }}
    >
      <div className="rail">
        <div className="buf" style={{ width: `${buffered * 100}%` }} />
        <div className="fill" style={{ width: `${v * 100}%` }} />
      </div>
      <div className={`knob ${duration ? 'dot' : ''}`} style={{ left: `${v * 100}%` }} />
    </div>
  )
}

export function Transport({ size = 18, dark = false }: { size?: number; dark?: boolean }) {
  const { playing, repeat, order, radio, loading } = usePlayer()
  const p = usePlayer.getState()
  const dim = dark ? 'rgba(255,255,255,.55)' : 'var(--muted)'
  const onColor = dark ? '#fff' : 'var(--accent)'
  const small = Math.round(size * 0.78)
  const repeatIcon: IconName = repeat === 'one' ? 'repeat1' : 'repeat'
  return (
    <div className="transport" style={{ gap: size * 0.5 }}>
      <IconButton
        icon="shuffle"
        size={small}
        label={T('Shuffle')}
        disabled={!!radio}
        style={{ color: order ? onColor : dim }}
        onClick={() => p.toggleShuffle()}
      />
      <IconButton icon="prev" size={size} label={T('Previous')} onClick={() => p.prev()} disabled={!!radio} />
      <button
        className="round-btn"
        style={{ width: size * 1.3 + 16, height: size * 1.3 + 16, position: 'relative' }}
        aria-label={T('Play/Pause')}
        onClick={() => p.toggle()}
      >
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', transition: 'transform .34s cubic-bezier(.3,1.5,.5,1), opacity .2s', transform: `scale(${playing ? 0.4 : 1})`, opacity: playing ? 0 : 1 }}>
          <Icon name="play" size={size * 1.3} />
        </span>
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', transition: 'transform .34s cubic-bezier(.3,1.5,.5,1), opacity .2s', transform: `scale(${playing ? 1 : 0.4})`, opacity: playing ? 1 : 0 }}>
          <Icon name="pause" size={size * 1.3} />
        </span>
        {loading && playing && <span style={{ position: 'absolute', inset: -2, borderRadius: 99, border: '2px solid transparent', borderTopColor: 'currentColor', opacity: 0.35, animation: 'spin .9s linear infinite' }} />}
      </button>
      <IconButton icon="next" size={size} label={T('Next')} onClick={() => p.next()} />
      <IconButton
        icon={repeatIcon}
        size={small}
        label={T('Repeat')}
        disabled={!!radio}
        style={{ color: repeat !== 'off' ? onColor : dim }}
        onClick={() => p.cycleRepeat()}
      />
    </div>
  )
}

const volumeIcon = (v: number, muted: boolean): IconName => (muted || v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume')

/** The speaker, which opens the volume above it; the wheel over it turns it. */
export function VolumeButton({ color, size = 16 }: { color?: string; size?: number }) {
  const { volume, muted } = usePlayer()
  const [el, setEl] = useState<HTMLElement | null>(null)
  return (
    <>
      <span
        onWheel={(e) => usePlayer.getState().setVolume(volume - Math.sign(e.deltaY) * 0.05)}
        style={{ display: 'inline-flex' }}
      >
        <IconButton icon={volumeIcon(volume, muted)} size={size} label={T('Volume')} style={{ color }} onClick={(e) => setEl(el ? null : (e.currentTarget as HTMLElement))} />
      </span>
      {el && (
        <Popover anchor={el} place="above" onClose={() => setEl(null)} className="volume-pop">
          <VerticalSlider value={muted ? 0 : volume} onChange={(v) => usePlayer.getState().setVolume(v)} />
          <span className="tnum muted" style={{ fontSize: 'calc(11px * var(--fs))', fontWeight: 500 }}>
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
        </Popover>
      )}
    </>
  )
}

function VerticalSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (y: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (r.bottom - 6 - y) / (r.height - 12)))
  }
  return (
    <div
      ref={ref}
      className="vslider"
      role="slider"
      aria-label={T('Volume')}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        onChange(at(e.clientY))
      }}
      onPointerMove={(e) => e.buttons && onChange(at(e.clientY))}
    >
      <div className="rail" />
      <div className="fill" style={{ height: `calc((100% - 12px) * ${value})` }} />
      <div className="knob" style={{ bottom: `calc(6px + (100% - 12px) * ${value})` }} />
    </div>
  )
}

/** A slim slider with the speaker before it, as Now Playing has. */
export function VolumeSlider({ width = 180 }: { width?: number }) {
  const { volume, muted } = usePlayer()
  const ref = useRef<HTMLDivElement>(null)
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (x - r.left) / r.width))
  }
  const v = muted ? 0 : volume
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <IconButton icon={volumeIcon(volume, muted)} size={14} label={T('Mute')} style={{ color: 'rgba(255,255,255,.7)' }} onClick={() => usePlayer.getState().toggleMute()} />
      <div
        ref={ref}
        className="scrub"
        style={{ width, flex: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          usePlayer.getState().setVolume(at(e.clientX))
        }}
        onPointerMove={(e) => e.buttons && usePlayer.getState().setVolume(at(e.clientX))}
      >
        <div className="rail">
          <div className="fill" style={{ width: `${v * 100}%` }} />
        </div>
        <div className="knob dot" style={{ left: `${v * 100}%` }} />
      </div>
    </div>
  )
}

/**
 * Where a plugin that plays elsewhere ("playback": "remote") plays: its
 * devices, as Spotify Connect's, the one in use checked.
 */
export function DeviceButton({ color, size = 16 }: { color?: string; size?: number }) {
  const tr = usePlayer((s) => s.queue[s.index])
  const source = useApp((s) => s.sources.find((x) => x.id === tr?.source))
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [devices, setDevices] = useState<Device[] | null>(null)
  if (!source || source.playback !== 'remote' || !source.caps.includes('remoteDevices')) return null
  const open = async (target: HTMLElement) => {
    setEl(target)
    setDevices(null)
    try {
      setDevices((await call<Device[]>(source.id, 'remoteDevices')) ?? [])
    } catch (e) {
      setEl(null)
      useApp.getState().say(errorMessage(e))
    }
  }
  return (
    <>
      <IconButton icon="laptop" size={size} label={T('Plays on')} style={{ color }} onClick={(e) => open(e.currentTarget as HTMLElement)} />
      {el && (
        <Popover anchor={el} place="above" onClose={() => setEl(null)} className="menu">
          {devices === null ? (
            <div style={{ padding: 12, display: 'grid', placeItems: 'center' }}>
              <span className="spinner" />
            </div>
          ) : (
            <Menu
              onClose={() => setEl(null)}
              items={[
                { heading: T('Plays on') },
                ...(devices.length
                  ? devices.map((d) => ({
                      label: d.name,
                      check: !!d.active,
                      disabled: !source.caps.includes('remoteUse'),
                      onClick: () =>
                        void call(source.id, 'remoteUse', { deviceId: d.id })
                          .then(() => useApp.getState().say(`${T('Plays on')} ${d.name}`))
                          .catch((e) => useApp.getState().say(errorMessage(e))),
                    }))
                  : [{ label: T('No devices: open Spotify on a phone or computer'), disabled: true }]),
              ]}
            />
          )}
        </Popover>
      )}
    </>
  )
}

/** On a phone: a card floating over the foot, what plays and its play button; a tap opens Now Playing. */
function MobileBar() {
  const tr = usePlayer((s) => s.queue[s.index])
  const playing = usePlayer((s) => s.playing)
  const nowPlaying = usePlayer((s) => s.nowPlaying)
  const radio = usePlayer((s) => s.radio)
  const duration = usePlayer((s) => s.duration)
  const t = usePlaybackTime(4)
  if (!tr) return null
  return (
    <div
      className="player-bar mobile"
      style={{ visibility: nowPlaying ? 'hidden' : undefined }}
      role="button"
      aria-label={T('Open Now Playing')}
      onClick={() => usePlayer.getState().openNowPlaying(true)}
    >
      <div className="mini">
        <Img source={tr.source} url={tr.album?.imageUrl} px={40} iconSize={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="t one">{tr.name}</span>
        <span className="a one" style={radio ? { color: 'var(--accent)' } : undefined}>
          {radio ? radio.name : (tr.artists ?? []).map((a) => a.name).join(', ')}
        </span>
      </div>
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
        <HeartButton track={tr} size={18} />
        <IconButton icon={playing ? 'pause' : 'play'} size={20} label={T('Play/Pause')} onClick={() => usePlayer.getState().toggle()} />
        <IconButton icon="next" size={20} label={T('Next')} onClick={() => usePlayer.getState().next()} />
      </span>
      <div className="line" style={{ width: `${duration ? (t / duration) * 100 : 0}%` }} />
    </div>
  )
}

export function PlayerBar() {
  const mobile = useMobile()
  const tr = usePlayer((s) => s.queue[s.index])
  const t = usePlaybackTime(4)
  const duration = usePlayer((s) => s.duration)
  const nowPlaying = usePlayer((s) => s.nowPlaying)
  const radio = usePlayer((s) => s.radio)
  const open = (pane?: string) => {
    if (pane) sessionStorage.setItem('npPane', pane)
    usePlayer.getState().openNowPlaying(true)
  }
  if (mobile) return <MobileBar />
  return (
    <div className="player-bar" style={{ visibility: nowPlaying ? 'hidden' : undefined }}>
      <div className="now">
        {!tr ? (
          <>
            <div className="mini">
              <Icon name="note" size={18} />
            </div>
            <span className="muted" style={{ fontSize: 'calc(13px * var(--fs))' }}>
              {T('Not Playing')}
            </span>
          </>
        ) : (
          <>
            <button className="open" onClick={() => open()} aria-label={T('Open Now Playing')}>
              <div className="mini">
                <Img source={tr.source} url={tr.album?.imageUrl} px={48} iconSize={18} />
                <span className="up">
                  <Icon name="down" size={18} style={{ transform: 'rotate(180deg)' }} />
                </span>
              </div>
              <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span className="t one">{tr.name}</span>
                {radio ? (
                  <span className="a one" style={{ color: 'var(--accent)' }}>
                    {radio.name}
                  </span>
                ) : (
                  <ArtistLinks artists={tr.artists} source={tr.source} className="a" />
                )}
              </div>
            </button>
            <HeartButton track={tr} size={15} />
          </>
        )}
      </div>
      <div className="center">
        <Transport size={15} />
        <div className="times">
          <span className="tnum">{clock(t)}</span>
          <Scrubber />
          <span className="tnum">{clock(duration)}</span>
        </div>
      </div>
      <div className="right">
        <IconButton icon="lyrics" size={16} label={T('Lyrics')} onClick={() => open('lyrics')} disabled={!tr} />
        <IconButton icon="queue" size={16} label={T('Up Next')} onClick={() => open('queue')} disabled={!tr} />
        <DeviceButton />
        <VolumeButton />
      </div>
    </div>
  )
}
