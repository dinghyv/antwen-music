import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router'
import { activeSource, useApp } from './store/app.ts'
import { usePlayer } from './store/player.ts'
import { useLang } from './lib/i18n.ts'
import { Sidebar } from './components/Sidebar.tsx'
import { PlayerBar } from './components/PlayerBar.tsx'
import { NowPlaying } from './components/NowPlaying.tsx'
import { Settings } from './components/Settings.tsx'
import { HostAsks, SignInDialog, Toast } from './components/Prompts.tsx'
import { BrowsePage, HomePage, SectionPage } from './pages/home.tsx'
import { AlbumPageView, ArtistPageView, PlaylistPageView, SearchPage } from './pages/catalog.tsx'
import { LikedPage, SavedAlbumsPage, ShowPageView, ShowsPage, StationsPage } from './pages/library.tsx'

function ToActive() {
  const id = useApp((s) => activeSource(s)?.id)
  return id ? <Navigate to={`/${id}`} replace /> : <Shell />
}

/** The window: the sidebar, the page open, the player bar, and what goes over them. */
function Shell() {
  useLang()
  const { src } = useParams()
  const sources = useApp((s) => s.sources)
  const source = sources.find((s) => s.id === src && s.enabled)
  const active = useApp((s) => activeSource(s))
  const setPrefs = useApp((s) => s.setPrefs)
  const prefActive = useApp((s) => s.prefs.activeSource)
  useEffect(() => {
    if (source && prefActive !== source.id) setPrefs({ activeSource: source.id })
  }, [source, prefActive, setPrefs])
  const loc = useLocation()
  const drawer = useApp((s) => s.drawer)
  // A page opened from the drawer closes it.
  useEffect(() => useApp.setState({ drawer: false }), [loc.pathname, loc.search])
  if (src && !source && active) return <Navigate to={`/${active.id}`} replace />
  return (
    <div className={`app ${drawer ? 'drawer-open' : ''}`}>
      <Sidebar source={source ?? active} />
      {drawer && <div className="drawer-scrim" onClick={() => useApp.setState({ drawer: false })} />}
      <main className="main">
        <Outlet />
        <PlayerBar />
      </main>
      <NowPlaying />
      <Settings />
      <SignInDialog />
      <HostAsks />
      <Toast />
    </div>
  )
}

export function App() {
  useEffect(() => {
    // Space plays and pauses wherever the focus is, but in a field.
    const key = (e: KeyboardEvent) => {
      // Ctrl/⌘ + , opens Settings, as in desktop apps.
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        useApp.getState().openSettings('general')
        return
      }
      const t = e.target as HTMLElement
      if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return
      e.preventDefault()
      usePlayer.getState().toggle()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ToActive />}>
          <Route index element={<HomePage />} />
        </Route>
        <Route path="/:src" element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="liked" element={<LikedPage />} />
          <Route path="albums" element={<SavedAlbumsPage />} />
          <Route path="radio" element={<StationsPage />} />
          <Route path="podcasts" element={<ShowsPage />} />
          <Route path="browse/:page" element={<BrowsePage />} />
          <Route path="section/:page/:index" element={<SectionPage />} />
          <Route path="album/:id" element={<AlbumPageView />} />
          <Route path="artist/:id" element={<ArtistPageView />} />
          <Route path="playlist/:id" element={<PlaylistPageView />} />
          <Route path="show/:id" element={<ShowPageView />} />
          <Route path="search" element={<SearchPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
