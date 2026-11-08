import { create } from 'zustand'
import type { Account, HostEvent, Me, SignInPrompt, SourceInfo } from '@antwen-music/protocol'
import { api, call, errorMessage } from '../lib/api.ts'
import { setLanguage, type Lang } from '../lib/i18n.ts'
import { applyFonts, type FontPrefs } from '../lib/fonts.ts'

export interface Prefs extends FontPrefs {
  language: Lang
  appearance: 'system' | 'light' | 'dark'
  quality: 'standard' | 'high' | 'lossless'
  activeSource?: string
  lyricsStage?: boolean
  stageStyle?: 'folia' | 'partita' | 'tilt'
  normalize?: boolean
  hotComments?: boolean
  smoke?: boolean
  playlistsOpen?: boolean
  savedOpen?: boolean
  volume?: number
}

const defaults: Prefs = { language: 'zh-CN', appearance: 'system', quality: 'high', normalize: true, playlistsOpen: true, savedOpen: true }

export interface SignInState {
  source: string
  prompt?: SignInPrompt
  error?: string
  done?: boolean
}

interface AppState {
  ready: boolean
  me?: Me
  prefs: Prefs
  sources: SourceInfo[]
  accounts: Record<string, Account | null | undefined>
  settings: false | string
  signIn: SignInState | null
  asks: HostEvent[]
  toast: { text: string; at: number } | null
  /** The sidebar, open as a drawer on a phone. */
  drawer: boolean
  /** The page each source last asked to open, as a sign-in's. */
  opened: Record<string, string>
  init(): Promise<void>
  setPrefs(p: Partial<Prefs>): void
  refreshSources(): Promise<void>
  loadAccount(id: string): Promise<void>
  startSignIn(id: string): Promise<void>
  signOut(id: string): Promise<void>
  openSettings(section?: string | false): void
  say(text: string): void
  settle(reqId: string): void
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function applyAppearance(a: Prefs['appearance']) {
  const dark = a === 'dark' || (a === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  prefs: defaults,
  sources: [],
  accounts: {},
  settings: false,
  signIn: null,
  asks: [],
  toast: null,
  drawer: false,
  opened: {},

  async init() {
    const [me, prefs] = await Promise.all([api<Me>('/api/me'), api<Partial<Prefs>>('/api/prefs')])
    const p = { ...defaults, ...prefs }
    setLanguage(p.language)
    applyAppearance(p.appearance)
    applyFonts(p)
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(get().prefs.appearance))
    set({ me, prefs: p })
    await get().refreshSources()
    listen()
    set({ ready: true })
  },

  setPrefs(patch) {
    const prefs = { ...get().prefs, ...patch }
    if (patch.language) setLanguage(patch.language)
    if (patch.appearance) applyAppearance(patch.appearance)
    applyFonts(prefs)
    set({ prefs })
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void api('/api/prefs', { method: 'PUT', body: get().prefs }), 400)
  },

  async refreshSources() {
    const sources = await api<SourceInfo[]>('/api/sources')
    set({ sources })
    for (const s of sources) if (s.enabled && s.caps.includes('account') && get().accounts[s.id] === undefined) void get().loadAccount(s.id)
  },

  async loadAccount(id) {
    try {
      const a = await call<Account | null>(id, 'account')
      set({ accounts: { ...get().accounts, [id]: a ?? null } })
    } catch {
      set({ accounts: { ...get().accounts, [id]: null } })
    }
  },

  async startSignIn(id) {
    if (get().signIn && !get().signIn!.done && !get().signIn!.error) return
    const { [id]: _, ...opened } = get().opened
    set({ signIn: { source: id }, opened })
    try {
      // The server signs in on its own and says how it went as events (signedIn, signInFailed).
      await call(id, 'signIn')
    } catch (e) {
      if (get().signIn?.source === id) set({ signIn: { source: id, error: errorMessage(e) } })
    }
  },

  async signOut(id) {
    await call(id, 'signOut').catch(() => {})
    set({ accounts: { ...get().accounts, [id]: null } })
  },

  openSettings(section = 'general') {
    set({ settings: section })
  },

  say(text) {
    set({ toast: { text, at: Date.now() } })
  },

  settle(reqId) {
    set({ asks: get().asks.filter((a) => !('reqId' in a) || a.reqId !== reqId) })
  },
}))

let source: EventSource | undefined
let hiddenTimer: ReturnType<typeof setTimeout> | undefined

function connect() {
  source?.close()
  source = new EventSource('/api/events')
  source.onmessage = (m) => onEvent(JSON.parse(m.data) as HostEvent & { replay?: boolean })
}

/**
 * The events from the server, while the tab is in front. A browser opens
 * six connections to a host at most, and each tab listening holds one: tabs
 * left behind let theirs go, and the server tells what they missed as they
 * come back.
 */
function listen() {
  connect()
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer)
    if (document.hidden) {
      hiddenTimer = setTimeout(() => {
        source?.close()
        source = undefined
      }, 10_000)
    } else if (!source) {
      connect()
      // An account may have changed meanwhile, as signed in from another tab.
      const st = useApp.getState()
      for (const s of st.sources) if (s.enabled && s.caps.includes('account')) void st.loadAccount(s.id)
    }
  })
}

function onEvent(e: HostEvent & { replay?: boolean }) {
  const st = useApp.getState()
  const ours = st.signIn?.source === e.source
  switch (e.kind) {
    case 'signInPrompt':
      if (ours) useApp.setState({ signIn: { ...st.signIn!, prompt: e.prompt } })
      // Told again as a tab comes back: only to the dialog still showing.
      else if (!e.replay) useApp.setState({ signIn: { source: e.source, prompt: e.prompt } })
      break
    case 'openURL': {
      useApp.setState({ opened: { ...st.opened, [e.source]: e.url } })
      if (e.replay) break
      // Opened from an event rather than a click, the browser may block it:
      // the sign-in dialogs offer it as a button too.
      const w = window.open(e.url, '_blank')
      if (!w && !st.signIn && !st.asks.length) st.say(e.url)
      break
    }
    case 'webSignIn':
    case 'waitForRedirect':
      if (!st.asks.some((a) => 'reqId' in a && a.reqId === e.reqId)) useApp.setState({ asks: [...st.asks, e] })
      break
    case 'answered':
      st.settle(e.reqId)
      break
    case 'signedIn':
      useApp.setState({ accounts: { ...st.accounts, [e.source]: e.account ?? null } })
      if (ours && !st.signIn!.done) {
        useApp.setState({ signIn: { ...st.signIn!, done: true } })
        setTimeout(() => useApp.getState().signIn?.done && useApp.setState({ signIn: null }), 900)
      }
      void st.loadAccount(e.source)
      break
    case 'signInFailed':
      if (ours && !st.signIn!.done) useApp.setState({ signIn: { source: e.source, error: e.error.message } })
      break
  }
}

/** The source a page belongs to, else the active one. */
export function activeSource(s: AppState): SourceInfo | undefined {
  const enabled = s.sources.filter((x) => x.enabled)
  return enabled.find((x) => x.id === s.prefs.activeSource) ?? enabled[0]
}

export function useSource(id: string | undefined): SourceInfo | undefined {
  return useApp((s) => s.sources.find((x) => x.id === id))
}

export const can = (s: SourceInfo | undefined, method: string) => !!s?.caps.includes(method)
