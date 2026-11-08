// What the host asks of the listener for a plugin: the QR code a sign-in
// shows, the cookies of a sign-in on the service's own page, and where a
// browser sign-in came back to. And the toasts.

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { HostEvent } from '@antwen-music/protocol'
import { api } from '../lib/api.ts'
import { PT, T, Tf } from '../lib/i18n.ts'
import { Icon } from '../lib/icons.tsx'
import { useApp } from '../store/app.ts'
import { Dialog, Spinner } from './ui.tsx'

function QR({ text }: { text: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    // A plugin may give a picture of the code itself, or what to encode.
    if (/^data:image\//.test(text) || /^https?:\/\/.*\.(png|jpe?g|svg)(\?|$)/i.test(text)) setSrc(text)
    else void QRCode.toDataURL(text, { margin: 0, width: 352, errorCorrectionLevel: 'M' }).then(setSrc)
  }, [text])
  return <div className="qr">{src && <img src={src} alt="QR" />}</div>
}

export function SignInDialog() {
  const signIn = useApp((s) => s.signIn)
  const source = useApp((s) => s.sources.find((x) => x.id === signIn?.source))
  const opened = useApp((s) => (signIn ? s.opened[signIn.source] : undefined))
  // A sign-in that came back through the browser asks for its address in a dialog of its own.
  const asking = useApp((s) => s.asks.some((a) => a.source === signIn?.source))
  if (!signIn || asking) return null
  const name = source ? PT(source.locales, source.name) : signIn.source
  const close = () => useApp.setState({ signIn: null })
  return (
    <Dialog onClose={close}>
      <h3>{Tf('Sign in to %s', name)}</h3>
      {signIn.done ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="check" size={18} style={{ color: 'var(--accent)' }} />
          <p>{signIn.prompt?.text ?? T('Signed in')}</p>
        </div>
      ) : signIn.error ? (
        <p style={{ color: 'var(--accent)' }}>{signIn.error}</p>
      ) : (
        <>
          {signIn.prompt?.qr && <QR text={signIn.prompt.qr} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: signIn.prompt?.qr ? 'center' : undefined }}>
            {!signIn.prompt?.qr && <Spinner />}
            <p style={{ textAlign: signIn.prompt?.qr ? 'center' : undefined }}>{signIn.prompt?.text ?? T('Signing in…')}</p>
          </div>
          {opened && (
            <a className="btn" style={{ alignSelf: 'flex-start' }} href={opened} target="_blank" rel="noreferrer">
              {T('Open the Sign-in Page')}
            </a>
          )}
        </>
      )}
      <div className="acts">
        {signIn.error && (
          <button className="btn primary" onClick={() => useApp.getState().startSignIn(signIn.source)}>
            {T('Try Again')}
          </button>
        )}
        <button className="btn" onClick={close}>
          {signIn.done || signIn.error ? T('Done') : T('Cancel')}
        </button>
      </div>
    </Dialog>
  )
}

export function HostAsks() {
  const asks = useApp((s) => s.asks)
  const ask = asks[0]
  if (!ask || (ask.kind !== 'webSignIn' && ask.kind !== 'waitForRedirect')) return null
  return <Ask key={ask.reqId} ask={ask} />
}

function Ask({ ask }: { ask: Extract<HostEvent, { kind: 'webSignIn' | 'waitForRedirect' }> }) {
  const [v, setV] = useState('')
  const opened = useApp((s) => s.opened[ask.source])
  const answer = async (value?: unknown, error?: string) => {
    await api(`/api/sources/${ask.source}/answer`, { body: { reqId: ask.reqId, value, error } })
    useApp.getState().settle(ask.reqId)
  }
  if (ask.kind === 'webSignIn') {
    const host = new URL(ask.cookiesOf).host
    return (
      <Dialog onClose={() => answer(undefined, 'Cancelled')}>
        <h3>{T('Finish Signing In')}</h3>
        <p>{T('Sign in on the page that opened, then paste the cookies of {host} here.').replace('{host}', host)}</p>
        <p>
          {T('The cookies it needs')}: <b>{ask.until.join(', ')}</b>
        </p>
        <a className="btn" style={{ alignSelf: 'flex-start' }} href={ask.url} target="_blank" rel="noreferrer">
          {T('Open the Sign-in Page')}
        </a>
        <textarea className="field" rows={4} placeholder="MUSIC_U=…; __csrf=…" value={v} onChange={(e) => setV(e.target.value)} />
        <div className="acts">
          <button className="btn" onClick={() => answer(undefined, 'Cancelled')}>
            {T('Cancel')}
          </button>
          <button className="btn primary" disabled={!ask.until.every((c) => v.includes(`${c}=`))} onClick={() => answer(v.trim().replace(/^cookie:\s*/i, ''))}>
            {T('Done')}
          </button>
        </div>
      </Dialog>
    )
  }
  return (
    <Dialog onClose={() => answer(undefined, 'Cancelled')}>
      <h3>{T('Finish Signing In')}</h3>
      <p>
        1. {T('Open the sign-in page and approve.')}
        <br />
        2. {Tf('The browser then goes to %s, which fails to load: that is expected.', `127.0.0.1:${ask.port}${ask.path}`)}
        <br />
        3. {T('Copy the whole address from the address bar and paste it here.')}
      </p>
      {opened && (
        <a className="btn primary" style={{ alignSelf: 'flex-start' }} href={opened} target="_blank" rel="noreferrer">
          {T('Open the Sign-in Page')}
        </a>
      )}
      <input className="field" autoFocus placeholder={`http://127.0.0.1:${ask.port}${ask.path || '/'}?code=…`} value={v} onChange={(e) => setV(e.target.value)} />
      <div className="acts">
        <button className="btn" onClick={() => answer(undefined, 'Cancelled')}>
          {T('Cancel')}
        </button>
        <button
          className="btn primary"
          disabled={!/^https?:\/\//.test(v.trim())}
          onClick={() => {
            const u = new URL(v.trim())
            const query: Record<string, string> = {}
            u.searchParams.forEach((val, k) => (query[k] ??= val))
            void answer(query)
          }}
        >
          {T('Done')}
        </button>
      </div>
    </Dialog>
  )
}

export function Toast() {
  const toast = useApp((s) => s.toast)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!toast) return
    setShown(true)
    const t = setTimeout(() => setShown(false), 3200)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast || !shown) return null
  return (
    <div className="toast" key={toast.at}>
      {toast.text}
    </div>
  )
}
