// The player: its queue, shuffling and repeating, the audio element that
// plays what a plugin's stream answers, fades, loudness, the system's media
// controls, stations that keep the queue going, and the session kept on the
// server to pick up from. A plugin with "playback": "remote" plays elsewhere,
// and the player drives it through its remote functions instead.

import { create } from 'zustand'
import type { PlayableStream, RemoteState, Track } from '@antwen-music/protocol'
import { api, call, errorCode, errorMessage } from '../lib/api.ts'
import { imageFor } from '../lib/image.ts'
import { T } from '../lib/i18n.ts'
import { useApp } from './app.ts'

export type Repeat = 'off' | 'all' | 'one'

interface Radio {
  source: string
  id: string
  name: string
}

interface PlayerState {
  queue: Track[]
  /** The queue as it was before shuffling, to go back to. */
  order: Track[] | null
  index: number
  playing: boolean
  loading: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  repeat: Repeat
  stream: PlayableStream | null
  radio: Radio | null
  error: string | null
  liked: Record<string, boolean>
  nowPlaying: boolean
  current(): Track | undefined
  playQueue(tracks: Track[], start?: number): void
  playShuffled(tracks: Track[]): void
  playStation(source: string, id: string, name: string): Promise<void>
  leaveStation(): void
  jump(i: number): void
  toggle(): void
  play(): void
  pause(): void
  next(auto?: boolean): void
  prev(): void
  seek(ms: number): void
  setVolume(v: number): void
  toggleMute(): void
  toggleShuffle(): void
  cycleRepeat(): void
  playNext(tracks: Track[]): void
  addToQueue(tracks: Track[]): void
  removeAt(i: number): void
  move(from: number, to: number): void
  clearUpNext(): void
  setLiked(source: string, id: string, on: boolean, episode?: boolean): Promise<void>
  checkLiked(source: string, ids: string[]): Promise<void>
  openNowPlaying(open: boolean): void
  restore(): Promise<void>
}

export const audio = new Audio()
audio.preload = 'auto'

const key = (source: string | undefined, id: string) => `${source ?? ''}:${id}`
const isRemote = (source?: string) => useApp.getState().sources.find((s) => s.id === source)?.playback === 'remote'
const shuffled = <T,>(a: T[]) => {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

let loadSeq = 0
let fadeTimer: number | undefined
let normalize = 1
let playedTimer: ReturnType<typeof setTimeout> | undefined
let remoteTimer: ReturnType<typeof setInterval> | undefined

/** Eases the element's volume to v over ms, then calls done. */
// The fade still pending: finished at once if the tab is hidden mid-fade.
let fadeEnd: (() => void) | null = null

function fadeTo(v: number, ms: number, done?: () => void) {
  cancelAnimationFrame(fadeTimer!)
  const target = Math.max(0, Math.min(1, v))
  const finish = () => {
    cancelAnimationFrame(fadeTimer!)
    fadeEnd = null
    audio.volume = target
    done?.()
  }
  // A hidden tab runs no animation frames: a fade by them would never end,
  // and a song started in the background would stay at volume 0.
  if (document.hidden) return finish()
  const from = audio.volume
  const start = performance.now()
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / ms)
    if (t >= 1) return finish()
    audio.volume = Math.max(0, Math.min(1, from + (target - from) * t))
    fadeTimer = requestAnimationFrame(step)
  }
  fadeEnd = finish
  fadeTimer = requestAnimationFrame(step)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) fadeEnd?.()
})

const level = () => {
  const s = usePlayer.getState()
  return s.muted ? 0 : s.volume * s.volume * normalize
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  order: null,
  index: -1,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  repeat: 'off',
  stream: null,
  radio: null,
  error: null,
  liked: {},
  nowPlaying: false,

  current() {
    const s = get()
    return s.queue[s.index]
  },

  playQueue(tracks, start = 0) {
    if (!tracks.length) return
    let i = start
    while (i < tracks.length && tracks[i].unavailable) i++
    if (i >= tracks.length) return useApp.getState().say(T('Nothing to play'))
    set({ queue: tracks, order: null, radio: null })
    void load(i, true)
  },

  playShuffled(tracks) {
    const playable = tracks.filter((t) => !t.unavailable)
    if (!playable.length) return
    set({ queue: shuffled(playable), order: tracks, radio: null })
    void load(0, true)
  },

  async playStation(source, id, name) {
    try {
      const tracks = await call<Track[]>(source, 'stationNext', { id })
      if (!tracks?.length) return
      set({ queue: tracks, order: null, radio: { source, id, name } })
      void load(0, true)
    } catch (e) {
      useApp.getState().say(errorMessage(e))
    }
  },

  leaveStation() {
    set({ radio: null })
  },

  jump(i) {
    void load(i, true)
  },

  toggle() {
    if (get().playing) get().pause()
    else get().play()
  },

  play() {
    const tr = get().current()
    if (!tr) return
    if (isRemote(tr.source)) {
      void call(tr.source!, 'remoteResume').then(() => set({ playing: true }))
      return
    }
    if (!audio.src) {
      void load(get().index, true, get().position)
      return
    }
    audio.volume = 0
    void audio.play().then(
      () => fadeTo(level(), 220),
      () => {},
    )
  },

  pause() {
    const tr = get().current()
    if (tr && isRemote(tr.source)) {
      void call(tr.source!, 'remotePause').then(() => set({ playing: false }))
      return
    }
    set({ playing: false })
    fadeTo(0, 180, () => audio.pause())
  },

  next(auto = false) {
    const s = get()
    if (auto && s.repeat === 'one') {
      void load(s.index, true)
      return
    }
    let i = s.index + 1
    while (i < s.queue.length && s.queue[i].unavailable) i++
    if (i >= s.queue.length) {
      if (s.radio) {
        void moreFromStation().then((more) => {
          if (more) void load(get().index + 1, true)
        })
        return
      }
      if (s.repeat === 'all' && s.queue.length) i = 0
      else {
        if (auto) set({ playing: false, position: 0 })
        return
      }
    }
    void load(i, true)
  },

  prev() {
    const s = get()
    if (s.position > 3000 || s.index <= 0) {
      get().seek(0)
      return
    }
    void load(s.index - 1, true)
  },

  seek(ms) {
    const tr = get().current()
    set({ position: ms })
    if (tr && isRemote(tr.source)) {
      void call(tr.source!, 'remoteSeek', { position: Math.round(ms) })
      return
    }
    if (audio.src) {
      audio.volume = 0
      audio.currentTime = ms / 1000
      if (get().playing) fadeTo(level(), 260)
    }
  },

  setVolume(v) {
    v = Math.max(0, Math.min(1, v))
    set({ volume: v, muted: false })
    const tr = get().current()
    if (tr && isRemote(tr.source)) void call(tr.source!, 'remoteVolume', { percent: Math.round(v * 100) })
    else audio.volume = level()
    useApp.getState().setPrefs({ volume: v })
  },

  toggleMute() {
    set({ muted: !get().muted })
    audio.volume = level()
  },

  toggleShuffle() {
    const s = get()
    const cur = s.current()
    if (s.order) {
      // Back to the order it was in, at the song playing.
      const order = s.order
      const i = cur ? order.findIndex((t) => t.id === cur.id && t.source === cur.source) : 0
      set({ queue: order, order: null, index: Math.max(0, i) })
    } else {
      const rest = shuffled(s.queue.filter((_, i) => i !== s.index))
      set({ order: s.queue, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 })
    }
    saveSession()
  },

  cycleRepeat() {
    const r = get().repeat
    set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' })
    saveSession()
  },

  playNext(tracks) {
    const s = get()
    if (s.index < 0) return get().playQueue(tracks)
    const q = [...s.queue]
    q.splice(s.index + 1, 0, ...tracks)
    set({ queue: q })
    saveSession()
  },

  addToQueue(tracks) {
    const s = get()
    if (s.index < 0) return get().playQueue(tracks)
    set({ queue: [...s.queue, ...tracks] })
    saveSession()
  },

  removeAt(i) {
    const s = get()
    if (i === s.index) return
    const q = s.queue.filter((_, k) => k !== i)
    set({ queue: q, index: i < s.index ? s.index - 1 : s.index })
    saveSession()
  },

  move(from, to) {
    const s = get()
    const q = [...s.queue]
    const [t] = q.splice(from, 1)
    q.splice(to, 0, t)
    let index = s.index
    if (from === s.index) index = to
    else if (from < s.index && to >= s.index) index--
    else if (from > s.index && to <= s.index) index++
    set({ queue: q, index })
    saveSession()
  },

  clearUpNext() {
    const s = get()
    set({ queue: s.queue.slice(0, s.index + 1) })
    saveSession()
  },

  async setLiked(source, id, on, episode = false) {
    const k = key(source, id)
    set({ liked: { ...get().liked, [k]: on } })
    try {
      await call(source, episode ? 'likeEpisode' : 'like', { id, on })
    } catch (e) {
      set({ liked: { ...get().liked, [k]: !on } })
      useApp.getState().say(errorMessage(e))
    }
  },

  async checkLiked(source, ids) {
    const src = useApp.getState().sources.find((s) => s.id === source)
    if (!src?.caps.includes('isLiked') || !ids.length) return
    try {
      const r = await call<Record<string, boolean>>(source, 'isLiked', { ids })
      const liked = { ...get().liked }
      for (const [id, on] of Object.entries(r ?? {})) liked[key(source, id)] = on
      set({ liked })
    } catch {
      /* hearts stay as they were */
    }
  },

  openNowPlaying(open) {
    set({ nowPlaying: open })
  },

  async restore() {
    const v = useApp.getState().prefs.volume
    if (typeof v === 'number') set({ volume: v })
    audio.volume = level()
    try {
      const s = await api<{ queue?: Track[]; index?: number; position?: number; repeat?: Repeat; order?: Track[] | null }>('/api/session')
      if (s.queue?.length && (s.index ?? -1) >= 0) {
        set({ queue: s.queue, index: s.index!, position: s.position ?? 0, repeat: s.repeat ?? 'off', order: s.order ?? null })
        const t = s.queue[s.index!]
        if (t?.source) void get().checkLiked(t.source, [t.id])
        updateMetadata()
      }
    } catch {
      /* a fresh start */
    }
  },
}))

export const isLiked = (liked: Record<string, boolean>, t?: Track) => (t ? !!liked[key(t.source, t.id)] : false)

/** Loads the song at i of the queue, and plays it if play. */
async function load(i: number, play: boolean, at = 0) {
  const s = usePlayer.getState()
  const tr = s.queue[i]
  if (!tr) return
  const seq = ++loadSeq
  usePlayer.setState({ index: i, position: at, duration: tr.duration || 0, loading: true, error: null, stream: null, playing: play })
  updateMetadata()
  saveSession()
  clearTimeout(playedTimer)
  clearInterval(remoteTimer)
  if (tr.source) void usePlayer.getState().checkLiked(tr.source, [tr.id])
  if (!tr.source) return
  if (isRemote(tr.source)) {
    audio.pause()
    audio.removeAttribute('src')
    const q = usePlayer.getState().queue.filter((t) => t.source === tr.source)
    try {
      await call(tr.source, 'remotePlay', { ids: q.map((t) => t.id), start: q.indexOf(tr), position: Math.round(at) })
      if (seq !== loadSeq) return
      usePlayer.setState({ loading: false })
      remoteTimer = setInterval(() => void pollRemote(tr.source!), 1000)
    } catch (e) {
      usePlayer.setState({ loading: false, playing: false, error: errorMessage(e) })
      useApp.getState().say(errorMessage(e))
    }
    return
  }
  try {
    const quality = useApp.getState().prefs.quality
    const st = await call<PlayableStream>(tr.source, 'stream', { id: tr.id, quality })
    if (seq !== loadSeq) return
    normalize = useApp.getState().prefs.normalize && st.gain ? Math.min(1, 10 ** (st.gain / 20)) : 1
    usePlayer.setState({ stream: st })
    audio.src = st.playUrl
    if (at) audio.currentTime = at / 1000
    audio.volume = 0
    if (play) {
      await audio.play()
      fadeTo(level(), 260)
    } else audio.volume = level()
    playedTimer = setTimeout(() => {
      const src = useApp.getState().sources.find((x) => x.id === tr.source)
      if (src?.caps.includes('played')) void call(tr.source!, 'played', { id: tr.id }).catch(() => {})
    }, 10_000)
  } catch (e) {
    if (seq !== loadSeq) return
    // play() was interrupted by pause() or a new src: expected, not an error.
    if ((e as Error).name === 'AbortError') {
      usePlayer.setState({ loading: false, playing: !audio.paused })
      return
    }
    const code = errorCode(e)
    usePlayer.setState({ loading: false, error: errorMessage(e) })
    if (code === 'signIn') void useApp.getState().startSignIn(tr.source)
    else useApp.getState().say(errorMessage(e))
    if ((e as Error).name === 'NotAllowedError') {
      usePlayer.setState({ playing: false })
      return
    }
    // A song that can't be played gives way to the next.
    if (code === 'unavailable' || code === 'unsupported') {
      const q = [...usePlayer.getState().queue]
      q[i] = { ...q[i], unavailable: true }
      usePlayer.setState({ queue: q })
      if (play) usePlayer.getState().next(true)
    } else usePlayer.setState({ playing: false })
  }
}

async function pollRemote(source: string) {
  try {
    const st = await call<RemoteState | null>(source, 'remoteState')
    if (!st) return
    const q = usePlayer.getState().queue
    const i = st.trackId ? q.findIndex((t) => t.id === st.trackId && t.source === source) : -1
    usePlayer.setState({
      playing: st.playing,
      position: st.position,
      duration: st.duration,
      volume: st.volume / 100,
      ...(i >= 0 ? { index: i } : {}),
    })
  } catch {
    /* polled again in a second */
  }
}

async function moreFromStation(): Promise<boolean> {
  const r = usePlayer.getState().radio
  if (!r) return false
  try {
    const more = await call<Track[]>(r.source, 'stationNext', { id: r.id })
    if (!more?.length) return false
    usePlayer.setState({ queue: [...usePlayer.getState().queue, ...more] })
    return true
  } catch {
    return false
  }
}

let sessionTimer: ReturnType<typeof setTimeout> | undefined
function saveSession() {
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    const s = usePlayer.getState()
    const from = Math.max(0, s.index - 100)
    void api('/api/session', {
      method: 'PUT',
      body: {
        queue: s.queue.slice(from, s.index + 400),
        index: s.index - from,
        position: Math.round(s.position),
        repeat: s.repeat,
        order: s.order ? s.order.slice(0, 500) : null,
      },
    }).catch(() => {})
  }, 800)
}
setInterval(() => usePlayer.getState().playing && saveSession(), 30_000)

function updateMetadata() {
  const tr = usePlayer.getState().current()
  if (!('mediaSession' in navigator) || !tr) return
  const art = imageFor(tr.source, tr.album?.imageUrl, 512)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: tr.name,
    artist: (tr.artists ?? []).map((a) => a.name).join(', '),
    album: tr.album?.name ?? '',
    artwork: art ? [{ src: new URL(art, location.href).href, sizes: '512x512' }] : [],
  })
  document.title = `${tr.name} · ${(tr.artists ?? []).map((a) => a.name).join(', ')}`
}

// ---- The element's own events ----

audio.addEventListener('playing', () => usePlayer.setState({ playing: true, loading: false }))
audio.addEventListener('waiting', () => usePlayer.setState({ loading: true }))
audio.addEventListener('canplay', () => usePlayer.setState({ loading: false }))
audio.addEventListener('pause', () => {
  // The browser or the system's media keys paused it.
  if (!audio.ended && usePlayer.getState().playing && audio.volume > 0.01) usePlayer.setState({ playing: false })
})
audio.addEventListener('timeupdate', () => usePlayer.setState({ position: audio.currentTime * 1000 }))
audio.addEventListener('durationchange', () => {
  if (Number.isFinite(audio.duration)) usePlayer.setState({ duration: audio.duration * 1000 })
})
audio.addEventListener('ended', () => usePlayer.getState().next(true))
audio.addEventListener('error', () => {
  if (!audio.src || !usePlayer.getState().stream) return
  usePlayer.setState({ loading: false, error: T('Unable to play this') })
})

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => usePlayer.getState().play())
  ms.setActionHandler('pause', () => usePlayer.getState().pause())
  ms.setActionHandler('previoustrack', () => usePlayer.getState().prev())
  ms.setActionHandler('nexttrack', () => usePlayer.getState().next())
  ms.setActionHandler('seekto', (d) => d.seekTime != null && usePlayer.getState().seek(d.seekTime * 1000))
  usePlayer.subscribe((s, p) => {
    if (s.playing !== p.playing) ms.playbackState = s.playing ? 'playing' : 'paused'
  })
}

/** Where playback is, read from the element each frame, for what moves smoothly. */
export function playbackTime(): number {
  const s = usePlayer.getState()
  const tr = s.current()
  if (tr && isRemote(tr.source)) return s.position
  return audio.src ? audio.currentTime * 1000 : s.position
}
