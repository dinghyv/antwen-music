// The sidebar: the search field, the source's pages as its navigation names
// them, the listener's playlists, and their account at the foot.

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import type { NavItem, Playlist, SourceInfo } from '@antwen-music/protocol'
import { call, errorMessage } from '../lib/api.ts'
import { PT, T, Tf } from '../lib/i18n.ts'
import { Icon, navIcon, type IconName } from '../lib/icons.tsx'
import { useImage } from '../lib/image.ts'
import { can, useApp } from '../store/app.ts'
import { usePlayer } from '../store/player.ts'
import { usePlaylists } from './tracks.tsx'
import { AskText, Confirm, IconButton, Menu, Popover } from './ui.tsx'

const builtinPages: Record<string, { path: string; needs: string; label: string; icon: IconName }> = {
  home: { path: '', needs: '', label: 'Home', icon: 'home' },
  liked: { path: '/liked', needs: 'liked', label: 'Liked Songs', icon: 'heart' },
  savedAlbums: { path: '/albums', needs: 'savedAlbums', label: 'Saved Albums', icon: 'album' },
  stations: { path: '/radio', needs: 'stations', label: 'Radio', icon: 'radio' },
  shows: { path: '/podcasts', needs: 'shows', label: 'Podcasts', icon: 'podcast' },
}

function sidebarItems(s: SourceInfo): { icon: IconName; label: string; to: string }[] {
  let nav: NavItem[] = s.navigation
  if (!nav.length) nav = (['home', 'liked', 'savedAlbums', 'stations', 'shows'] as const).map((b) => ({ builtin: b }))
  const out: { icon: IconName; label: string; to: string }[] = []
  for (const n of nav) {
    if (!n.builtin) {
      if (can(s, 'browse') && n.page) out.push({ icon: navIcon(n.icon), label: PT(s.locales, n.title ?? ''), to: `/${s.id}/browse/${encodeURIComponent(n.page)}` })
      continue
    }
    const b = builtinPages[n.builtin]
    if (!b || (b.needs && !can(s, b.needs))) continue
    out.push({ icon: n.icon ? navIcon(n.icon) : b.icon, label: n.title ? PT(s.locales, n.title) : T(b.label), to: `/${s.id}${b.path}` })
  }
  return out
}

export function Sidebar({ source }: { source?: SourceInfo }) {
  const loc = useLocation()
  const nav = useNavigate()
  const { prefs, setPrefs } = useApp()
  const lists = usePlaylists(source?.id)
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [plMenu, setPlMenu] = useState<{ pl: Playlist; at: { x: number; y: number } } | null>(null)
  const [ask, setAsk] = useState<{ kind: 'rename' | 'delete'; pl: Playlist } | null>(null)
  const go = (to: string) => {
    usePlayer.getState().openNowPlaying(false)
    useApp.setState({ drawer: false })
    nav(to)
  }
  const path = decodeURIComponent(loc.pathname)
  const items = source ? sidebarItems(source) : []
  const searching = loc.pathname.endsWith('/search')
  const mine = (lists.data ?? []).filter((p) => p.mine)
  const saved = (lists.data ?? []).filter((p) => !p.mine)
  const refresh = () => qc.invalidateQueries({ queryKey: [source?.id, 'playlists', null] })

  const row = (key: string, to: string, icon: IconName, label: string) => (
    <button key={key} className={`nav-item ${decodeURIComponent(to) === path ? 'on' : ''}`} onClick={() => go(to)}>
      <Icon name={icon} size={17} />
      <span className="one">{label}</span>
    </button>
  )

  return (
    <aside className={`sidebar ${useApp((s) => s.drawer) ? 'open' : ''}`}>
      <SourceSwitcher active={source} />
      <SearchField source={source} />
      <div className="side-scroll">
        {items.map((it) => row(it.to, it.to, it.icon, it.label))}
        {searching && row('search', loc.pathname + loc.search, 'search', T('Search Results'))}
        {source && can(source, 'playlists') && (
          <>
            <div className="side-head">
              <span>{T('My Playlists')}</span>
              <button aria-label={T('Show or hide')} onClick={() => setPrefs({ playlistsOpen: !prefs.playlistsOpen })}>
                <Icon name="down" size={12} className={`chev ${prefs.playlistsOpen ? '' : 'closed'}`} />
              </button>
              {can(source, 'createPlaylist') && (
                <button aria-label={T('New Playlist')} onClick={() => setCreating(true)}>
                  <Icon name="plus" size={13} />
                </button>
              )}
            </div>
            {prefs.playlistsOpen &&
              mine.map((p) => (
                <PlaylistRow
                  key={p.id}
                  source={source.id}
                  pl={p}
                  on={path === `/${source.id}/playlist/${p.id}`}
                  onOpen={() => go(`/${source.id}/playlist/${encodeURIComponent(p.id)}`)}
                  onMenu={(at) => !p.fixed && setPlMenu({ pl: p, at })}
                />
              ))}
            {saved.length > 0 && (
              <>
                <div className="side-head">
                  <span>{T('Saved Playlists')}</span>
                  <button aria-label={T('Show or hide')} onClick={() => setPrefs({ savedOpen: !prefs.savedOpen })}>
                    <Icon name="down" size={12} className={`chev ${prefs.savedOpen ? '' : 'closed'}`} />
                  </button>
                </div>
                {prefs.savedOpen &&
                  saved.map((p) => (
                    <PlaylistRow
                      key={p.id}
                      source={source.id}
                      pl={p}
                      on={path === `/${source.id}/playlist/${p.id}`}
                      onOpen={() => go(`/${source.id}/playlist/${encodeURIComponent(p.id)}`)}
                    />
                  ))}
              </>
            )}
          </>
        )}
      </div>
      <AccountButton source={source} />
      {creating && source && (
        <AskText
          title={T('New Playlist')}
          placeholder={T('Playlist Name')}
          action={T('Create')}
          onDone={async (name) => {
            setCreating(false)
            if (!name) return
            try {
              const pl = await call<Playlist>(source.id, 'createPlaylist', { name })
              await refresh()
              if (pl?.id) go(`/${source.id}/playlist/${encodeURIComponent(pl.id)}`)
            } catch (e) {
              useApp.getState().say(errorMessage(e))
            }
          }}
        />
      )}
      {plMenu && source && (
        <Popover at={plMenu.at} onClose={() => setPlMenu(null)} className="menu">
          <Menu
            onClose={() => setPlMenu(null)}
            items={[
              ...(can(source, 'renamePlaylist') ? [{ label: T('Rename…'), onClick: () => setAsk({ kind: 'rename' as const, pl: plMenu.pl }) }] : []),
              ...(can(source, 'deletePlaylist') ? [{ label: T('Delete…'), onClick: () => setAsk({ kind: 'delete' as const, pl: plMenu.pl }) }] : []),
            ]}
          />
        </Popover>
      )}
      {ask?.kind === 'rename' && source && (
        <AskText
          title={T('Rename Playlist')}
          initial={ask.pl.name}
          action={T('Rename')}
          onDone={async (name) => {
            const pl = ask.pl
            setAsk(null)
            if (!name) return
            try {
              await call(source.id, 'renamePlaylist', { id: pl.id, name })
              await refresh()
              void qc.invalidateQueries({ queryKey: [source.id, 'playlist', { id: pl.id }] })
            } catch (e) {
              useApp.getState().say(errorMessage(e))
            }
          }}
        />
      )}
      {ask?.kind === 'delete' && source && (
        <Confirm
          title={Tf('Delete “%s”?', ask.pl.name)}
          action={T('Delete')}
          onDone={async (ok) => {
            const pl = ask.pl
            setAsk(null)
            if (!ok) return
            try {
              await call(source.id, 'deletePlaylist', { id: pl.id })
              await refresh()
              if (path === `/${source.id}/playlist/${pl.id}`) go(`/${source.id}`)
            } catch (e) {
              useApp.getState().say(errorMessage(e))
            }
          }}
        />
      )}
    </aside>
  )
}

function PlaylistRow({ source, pl, on, onOpen, onMenu }: { source: string; pl: Playlist; on: boolean; onOpen: () => void; onMenu?: (at: { x: number; y: number }) => void }) {
  const img = useImage(source, pl.imageUrl, 18)
  return (
    <button
      className={`nav-item small ${on ? 'on' : ''}`}
      onClick={onOpen}
      onContextMenu={(e) => {
        if (!onMenu) return
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <span className="pl-cover">{img ? <img src={img} alt="" /> : <Icon name={pl.fixed ? 'heart' : 'note'} size={10} />}</span>
      <span className="one">{pl.name}</span>
    </button>
  )
}

/** Chooses the active source, once there is another. */
function SourceSwitcher({ active }: { active?: SourceInfo }) {
  const sources = useApp(useShallow((s) => s.sources.filter((x) => x.enabled)))
  const setPrefs = useApp((s) => s.setPrefs)
  const nav = useNavigate()
  const [el, setEl] = useState<HTMLElement | null>(null)
  if (sources.length < 2 || !active) return null
  return (
    <>
      <button className="switcher" onClick={(e) => setEl(e.currentTarget)}>
        <span className="one">{PT(active.locales, active.name)}</span>
        <Icon name="upDown" size={11} style={{ color: 'var(--faint)' }} />
      </button>
      {el && (
        <Popover anchor={el} onClose={() => setEl(null)} className="menu">
          <Menu
            onClose={() => setEl(null)}
            items={sources.map((s) => ({
              label: PT(s.locales, s.name),
              check: s.id === active.id,
              onClick: () => {
                setPrefs({ activeSource: s.id })
                nav(`/${s.id}`)
              },
            }))}
          />
        </Popover>
      )}
    </>
  )
}

/** The search field, with what the source suggests as the listener types. */
function SearchField({ source }: { source?: SourceInfo }) {
  const nav = useNavigate()
  const loc = useLocation()
  const [text, setText] = useState(() => new URLSearchParams(loc.search).get('q') ?? '')
  const [focus, setFocus] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [hl, setHl] = useState(-1)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const recent: string[] = JSON.parse(localStorage.getItem('recentSearches') || '[]')

  useEffect(() => {
    if (!source || !can(source, 'suggest') || !text.trim()) {
      setSuggestions([])
      return
    }
    const t = setTimeout(() => {
      call<string[]>(source.id, 'suggest', { query: text.trim() })
        .then((s) => setSuggestions((s ?? []).slice(0, 8)))
        .catch(() => setSuggestions([]))
    }, 180)
    return () => clearTimeout(t)
  }, [text, source])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])

  const search = (q: string) => {
    q = q.trim()
    if (!q || !source) return
    setText(q)
    setFocus(false)
    input.current?.blur()
    localStorage.setItem('recentSearches', JSON.stringify([q, ...recent.filter((r) => r !== q)].slice(0, 8)))
    usePlayer.getState().openNowPlaying(false)
    useApp.setState({ drawer: false })
    const kind = new URLSearchParams(loc.search).get('kind')
    nav(`/${source.id}/search?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`)
  }
  const list = text.trim() ? suggestions : recent
  const open = focus && list.length > 0
  return (
    <div className="search-field" ref={box}>
      <div className="box">
        <Icon name="search" size={13} />
        <input
          id="side-search"
          enterKeyHint="search"
          ref={input}
          value={text}
          placeholder={T('Search')}
          onChange={(e) => {
            setText(e.target.value)
            setHl(-1)
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setHl((h) => Math.min(list.length - 1, h + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setHl((h) => Math.max(-1, h - 1)))
            else if (e.key === 'Enter') search(hl >= 0 ? list[hl] : text)
            else if (e.key === 'Escape') input.current?.blur()
          }}
        />
        {text && (
          <button className="clear" aria-label={T('Clear')} onMouseDown={(e) => e.preventDefault()} onClick={() => setText('')}>
            <Icon name="x" size={10} />
          </button>
        )}
      </div>
      {open && (
        <div className="popover menu" style={{ position: 'absolute', top: 38, left: 0, right: 0 }}>
          {!text.trim() && <div className="label">{T('Recent Searches')}</div>}
          {list.map((s, i) => (
            <button key={s} className={`item ${hl === i ? 'hl' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => search(s)}>
              <Icon name="search" size={13} />
              <span className="one">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The listener's account with the active source, and a menu of what they can do with it. */
function AccountButton({ source }: { source?: SourceInfo }) {
  const account = useApp((s) => (source ? s.accounts[source.id] : undefined))
  const { startSignIn, signOut, openSettings } = useApp()
  const nav = useNavigate()
  const [el, setEl] = useState<HTMLElement | null>(null)
  const avatar = useImage(source?.id, account?.imageUrl, 26)
  if (!source) {
    return (
      <button className="account" onClick={() => openSettings('general')}>
        <span className="avatar">
          <Icon name="settings" size={14} />
        </span>
        <span className="one muted">{T('Settings')}</span>
      </button>
    )
  }
  const signedIn = !!account
  return (
    <div className="account-row">
      <button
        className="account"
        onClick={(e) => (signedIn || !can(source, 'signIn') ? setEl(e.currentTarget) : startSignIn(source.id))}
        onContextMenu={(e) => (e.preventDefault(), setEl(e.currentTarget))}
      >
        <span className="avatar">{avatar ? <img src={avatar} alt="" /> : <Icon name="user" size={14} />}</span>
        <span className={`one ${signedIn ? '' : 'muted'}`} style={{ flex: 1, fontSize: 13 }}>
          {signedIn ? account!.name : can(source, 'signIn') ? Tf('Sign in to %s', PT(source.locales, source.name)) : PT(source.locales, source.name)}
        </span>
        {signedIn && <Icon name="upDown" size={11} style={{ color: 'var(--faint)' }} />}
      </button>
      {/* Settings, always a click away, signed in or not. */}
      <IconButton icon="settings" size={16} label={T('Settings')} style={{ color: 'var(--muted)' }} onClick={() => openSettings('general')} />
      {el && (
        <Popover anchor={el} place="above" onClose={() => setEl(null)} className="menu">
          <Menu
            onClose={() => setEl(null)}
            items={[
              ...(account?.page ? [{ label: T('My Page'), icon: 'user' as const, onClick: () => nav(`/${source.id}/browse/${encodeURIComponent(account.page!)}`) }] : []),
              { label: T('Settings…'), icon: 'settings' as const, onClick: () => openSettings('general') },
              ...(signedIn && can(source, 'signOut') ? [{ sep: true }, { label: T('Sign Out'), icon: 'signOut' as const, onClick: () => signOut(source.id) }] : []),
              ...(!signedIn && can(source, 'signIn') ? [{ sep: true }, { label: T('Sign In'), icon: 'user' as const, onClick: () => startSignIn(source.id) }] : []),
            ]}
          />
        </Popover>
      )}
    </div>
  )
}
