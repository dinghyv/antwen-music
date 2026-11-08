import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.tsx'
import { useApp } from './store/app.ts'
import { usePlayer } from './store/player.ts'
import { ApiError, errorMessage } from './lib/api.ts'
import { Login } from './components/Login.tsx'
import './styles/app.css'
import './styles/np.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, gcTime: 30 * 60_000 } },
})

function Boot() {
  const ready = useApp((s) => s.ready)
  const [error, setError] = useState('')
  const [signedOut, setSignedOut] = useState(false)
  useEffect(() => {
    // Any request answered 401 (at start, or a session that ran out) shows the sign-in page.
    const out = () => {
      setSignedOut(true)
      if (usePlayer.getState().playing) usePlayer.getState().pause()
    }
    window.addEventListener('antwen:signed-out', out)
    useApp
      .getState()
      .init()
      .then(() => usePlayer.getState().restore())
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(errorMessage(e))
      })
    return () => window.removeEventListener('antwen:signed-out', out)
  }, [])
  if (signedOut) return <Login />
  if (error)
    return (
      <div className="centered" style={{ height: '100vh' }}>
        <p>{error}</p>
        <button className="pill" onClick={() => location.reload()}>
          Retry
        </button>
      </div>
    )
  if (!ready)
    return (
      <div className="centered" style={{ height: '100vh' }}>
        <span className="spinner" />
      </div>
    )
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot />
    </QueryClientProvider>
  </StrictMode>,
)
