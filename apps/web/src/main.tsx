import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.tsx'
import { useApp } from './store/app.ts'
import { usePlayer } from './store/player.ts'
import { errorMessage } from './lib/api.ts'
import './styles/app.css'
import './styles/np.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, gcTime: 30 * 60_000 } },
})

function Boot() {
  const ready = useApp((s) => s.ready)
  const [error, setError] = useState('')
  useEffect(() => {
    useApp
      .getState()
      .init()
      .then(() => usePlayer.getState().restore())
      .catch((e) => setError(errorMessage(e)))
  }, [])
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
