// Settings, as MyGo Music's ui_settings.go has them: General, Plugins and
// Playback, and for admins, installing plugins and how each reaches the network.

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminPlugin, PluginPreview, SourceInfo } from '@antwen-music/protocol'
import { api, call, errorMessage } from '../lib/api.ts'
import { PT, T, Tf, type Lang } from '../lib/i18n.ts'
import { Icon, type IconName } from '../lib/icons.tsx'
import { CJK_FONTS, FONT_DEFAULTS, LATIN_FONTS, cjkSpacingSupported, type FontChoice } from '../lib/fonts.ts'
import { useApp, can } from '../store/app.ts'
import { Confirm, Dialog, Segmented, Spinner, Switch } from './ui.tsx'

export function Settings() {
  const section = useApp((s) => s.settings)
  const me = useApp((s) => s.me)
  const [q, setQ] = useState('')
  if (!section) return null
  const close = () => useApp.setState({ settings: false })
  const pages: [string, string, IconName][] = [
    ['general', T('General'), 'settings'],
    ['plugins', T('Plugins'), 'plug'],
    ['playback', T('Playback'), 'volume'],
  ]
  const shown = pages.filter(([, label]) => !q || label.toLowerCase().includes(q.toLowerCase()))
  return (
    <Dialog onClose={close} className="settings">
      <div className="side">
        <button className="round-btn phone-only" style={{ width: 34, height: 34 }} aria-label={T('Close')} onClick={close}>
          <Icon name="x" size={18} />
        </button>
        <div className="search-field" style={{ marginBottom: 10 }}>
          <div className="box">
            <Icon name="search" size={13} />
            <input value={q} placeholder={T('Search')} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {shown.map(([id, label, icon]) => (
          <button key={id} className={`nav-item ${section === id ? 'on' : ''}`} onClick={() => useApp.setState({ settings: id })}>
            <Icon name={icon} size={17} />
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {me && (
          <div className="muted" style={{ fontSize: 'calc(11.5px * var(--fs))', padding: '0 10px', lineHeight: 1.5 }}>
            antwen music · {me.authMode === 'oidc' ? Tf('Signed in to antwen as %s', me.name) : 'local'}
          </div>
        )}
      </div>
      <div className="body">
        {section === 'general' && <General />}
        {section === 'plugins' && <Plugins />}
        {section === 'playback' && <Playback />}
      </div>
    </Dialog>
  )
}

function Row({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="row">
      <div className="what">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </div>
  )
}

function General() {
  const { prefs, setPrefs, me } = useApp()
  return (
    <>
      <h2>
        <span>{T('General')}</span>
      </h2>
      <div className="group">
        <Row title={T('Language')}>
          <select className="field" style={{ width: 170 }} value={prefs.language} onChange={(e) => setPrefs({ language: e.target.value as Lang })}>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </Row>
        <Row title={T('Appearance')}>
          <Segmented
            value={prefs.appearance}
            onChange={(v) => setPrefs({ appearance: v })}
            options={[
              { value: 'system', label: T('System') },
              { value: 'light', label: T('Light') },
              { value: 'dark', label: T('Dark') },
            ]}
          />
        </Row>
      </div>
      <FontSettings />
      {me?.authMode === 'oidc' && (
        <div className="group">
          <Row title={T('Account')} sub={Tf('Signed in to antwen as %s', me.name)}>
            <button
              className="btn"
              onClick={async () => {
                await api('/api/auth/logout', { body: {} })
                location.href = '/api/auth/login'
              }}
            >
              {T('Sign out of antwen music')}
            </button>
          </Row>
        </div>
      )}
    </>
  )
}

/** A font picker: the list, and a name to type when "Custom…" is chosen. */
function FontPick({
  table,
  value,
  custom,
  placeholder,
  onChange,
}: {
  table: Record<string, FontChoice>
  value: string
  custom: string
  placeholder: string
  onChange: (key: string, custom?: string) => void
}) {
  const [text, setText] = useState(custom)
  useEffect(() => setText(custom), [custom])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
      <select className="field" style={{ width: 200 }} value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(table).map(([k, f]) => (
          <option key={k} value={k} style={{ fontFamily: f.stack }}>
            {T(f.label)}
          </option>
        ))}
        <option value="custom">{T('Custom…')}</option>
      </select>
      {value === 'custom' && (
        <input
          className="field"
          style={{ width: 200 }}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onChange('custom', text.trim())}
          onKeyDown={(e) => e.key === 'Enter' && onChange('custom', text.trim())}
        />
      )}
    </div>
  )
}

function Slider({ value, min, max, step, format, onChange }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ width: 150, accentColor: 'var(--accent)' }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="tnum muted" style={{ width: 52, textAlign: 'right', fontSize: 'calc(12.5px * var(--fs))' }}>
        {format(value)}
      </span>
    </div>
  )
}

function FontSettings() {
  const { prefs, setPrefs } = useApp()
  const latin = prefs.fontLatin ?? FONT_DEFAULTS.fontLatin
  const cjk = prefs.fontCjk ?? FONT_DEFAULTS.fontCjk
  const scale = prefs.fontScale ?? FONT_DEFAULTS.fontScale
  const spacing = prefs.letterSpacing ?? FONT_DEFAULTS.letterSpacing
  const isDefault =
    latin === FONT_DEFAULTS.fontLatin && cjk === FONT_DEFAULTS.fontCjk && scale === 1 && spacing === 0 && !prefs.cjkSpacing
  return (
    <>
      <h2 style={{ marginTop: 10 }}>
        <span>{T('Font')}</span>
        {!isDefault && (
          <button
            className="btn"
            onClick={() =>
              setPrefs({ fontLatin: FONT_DEFAULTS.fontLatin, fontCjk: FONT_DEFAULTS.fontCjk, fontScale: 1, letterSpacing: 0, cjkSpacing: false })
            }
          >
            {T('Reset Fonts')}
          </button>
        )}
      </h2>
      <div className="group">
        <div className="row col" style={{ gap: 4 }}>
          <div style={{ fontSize: 'calc(20px * var(--fs))', fontWeight: 600, lineHeight: 1.35 }}>MyGo Music 网页版 0123456789</div>
          <div className="muted">The quick brown fox 跳过了懒狗。Taylor Swift 的 reputation 发行于 2017 年。</div>
        </div>
        <Row title={T('English Font')} sub={T('Letters and digits use the English font; Chinese falls through to the Chinese one')}>
          <FontPick
            table={LATIN_FONTS}
            value={latin}
            custom={prefs.fontLatinCustom ?? ''}
            placeholder={T('Font name installed on this device, e.g. JetBrains Mono')}
            onChange={(k, c) => setPrefs(c === undefined ? { fontLatin: k } : { fontLatin: k, fontLatinCustom: c })}
          />
        </Row>
        <Row title={T('Chinese Font')}>
          <FontPick
            table={CJK_FONTS}
            value={cjk}
            custom={prefs.fontCjkCustom ?? ''}
            placeholder={T('Font name installed on this device, e.g. LXGW WenKai')}
            onChange={(k, c) => setPrefs(c === undefined ? { fontCjk: k } : { fontCjk: k, fontCjkCustom: c })}
          />
        </Row>
        <Row title={T('Font Size')}>
          <Slider value={scale} min={0.85} max={1.3} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setPrefs({ fontScale: v })} />
        </Row>
        <Row title={T('Letter Spacing')}>
          <Slider
            value={spacing}
            min={-0.05}
            max={0.2}
            step={0.01}
            format={(v) => (Math.abs(v) < 0.001 ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(2)}em`)}
            onChange={(v) => setPrefs({ letterSpacing: Math.round(v * 100) / 100 })}
          />
        </Row>
        <Row
          title={T('Space Between Chinese and English')}
          sub={cjkSpacingSupported ? T('A small gap between Chinese and Latin letters or digits') : T("This browser doesn't support it yet (Chrome / Edge 140+)")}
        >
          <Switch
            on={!!prefs.cjkSpacing}
            disabled={!cjkSpacingSupported}
            onChange={(v) => setPrefs({ cjkSpacing: v })}
            label={T('Space Between Chinese and English')}
          />
        </Row>
      </div>
    </>
  )
}

function Playback() {
  const { prefs, setPrefs } = useApp()
  return (
    <>
      <h2>
        <span>{T('Playback')}</span>
      </h2>
      <div className="group">
        <Row title={T('Quality')} sub={T("What's asked of plugins that have a choice, from the next song on")}>
          <select className="field" style={{ width: 170 }} value={prefs.quality} onChange={(e) => setPrefs({ quality: e.target.value as typeof prefs.quality })}>
            <option value="standard">{T('Standard')}</option>
            <option value="high">{T('High')}</option>
            <option value="lossless">{T('Lossless')}</option>
          </select>
        </Row>
        <Row title={T('Even Out Loudness')} sub={T("Adjust each song's volume by what its plugin measured of it, for them to sound as loud as each other")}>
          <Switch on={!!prefs.normalize} onChange={(v) => setPrefs({ normalize: v })} label={T('Even Out Loudness')} />
        </Row>
      </div>
    </>
  )
}

function Plugins() {
  const sources = useApp((s) => s.sources)
  const me = useApp((s) => s.me)
  const [installing, setInstalling] = useState(false)
  const admin = useQuery({
    queryKey: ['admin', 'plugins'],
    queryFn: () => api<{ plugins: AdminPlugin[]; proxyConfigured: boolean; globalProxyConfigured: boolean }>('/api/admin/plugins'),
    enabled: !!me?.admin,
  })
  const refresh = async () => {
    await useApp.getState().refreshSources()
    await admin.refetch()
  }
  const ids = useMemo(() => {
    const all = new Map<string, true>()
    for (const s of sources) all.set(s.id, true)
    for (const p of admin.data?.plugins ?? []) all.set(p.id, true)
    return [...all.keys()]
  }, [sources, admin.data])
  return (
    <>
      <h2>
        <span>{T('Plugins')}</span>
        {me?.admin && (
          <button className="round-btn" style={{ width: 30, height: 30 }} aria-label={T('Install Plugin')} title={T('Install Plugin')} onClick={() => setInstalling(true)}>
            <Icon name="plus" size={16} />
          </button>
        )}
      </h2>
      {ids.length === 0 && <div className="muted" style={{ fontSize: 'calc(13px * var(--fs))' }}>{T('No plugins yet')}</div>}
      {ids.map((id) => (
        <PluginBlock
          key={id}
          source={sources.find((s) => s.id === id)}
          admin={admin.data?.plugins.find((p) => p.id === id)}
          proxyConfigured={!!admin.data?.proxyConfigured}
          globalProxyConfigured={!!admin.data?.globalProxyConfigured}
          onChanged={refresh}
        />
      ))}
      {installing && (
        <InstallDialog
          onDone={async (ok) => {
            setInstalling(false)
            if (ok) await refresh()
          }}
        />
      )}
    </>
  )
}

function PluginBlock({
  source,
  admin,
  proxyConfigured,
  globalProxyConfigured,
  onChanged,
}: {
  source?: SourceInfo
  admin?: AdminPlugin
  proxyConfigured: boolean
  globalProxyConfigured: boolean
  onChanged: () => Promise<void>
}) {
  const account = useApp((s) => (source ? s.accounts[source.id] : undefined))
  const { startSignIn, signOut } = useApp()
  const qc = useQueryClient()
  const [removing, setRemoving] = useState(false)
  const [update, setUpdate] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const name = source ? PT(source.locales, source.name) : admin?.name ?? ''
  const version = source?.version ?? admin?.version
  const status = admin?.error ? admin.error : account ? Tf('Signed in as %s', account.name) : source && can(source, 'signIn') ? T('Not signed in') : ''
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await onChanged()
      qc.invalidateQueries()
    } catch (e) {
      useApp.getState().say(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="group">
      <div className="row">
        <div className="what">
          <b>
            {name} {version && <span className="muted" style={{ fontWeight: 400 }}>{version}</span>}
          </b>
          {status && <span style={admin?.error ? { color: 'var(--accent)' } : undefined}>{status}</span>}
          {admin?.repo && (
            <span>
              <a className="link" href={`https://github.com/${admin.repo}`} target="_blank" rel="noreferrer">
                github.com/{admin.repo}
              </a>
            </span>
          )}
        </div>
        {source && can(source, 'signIn') && source.enabled && (
          account ? (
            <button className="btn" onClick={() => signOut(source.id)}>{T('Sign Out')}</button>
          ) : (
            <button className="btn primary" onClick={() => startSignIn(source.id)}>{T('Sign In')}</button>
          )
        )}
        {source && (
          <Switch
            on={source.enabled}
            label={name}
            onChange={(on) => act(() => api(`/api/sources/${source.id}/enabled`, { body: { enabled: on } }))}
          />
        )}
      </div>
      {source?.enabled &&
        source.settings.map((s) => (
          <SettingField key={s.key} source={source} k={s.key} label={PT(source.locales, s.label)} help={s.help ? PT(source.locales, s.help) : undefined} link={s.link} />
        ))}
      {admin && (
        <div className="row col" style={{ gap: 10 }}>
          <label className="muted" style={{ fontSize: 'calc(12px * var(--fs))', fontWeight: 600 }}>
            {T('Admin')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'calc(13px * var(--fs))' }}>{T('Network Route')}</span>
            <select
              className="field"
              style={{ width: 160, height: 28, fontSize: 'calc(13px * var(--fs))' }}
              value={admin.route}
              disabled={busy}
              onChange={(e) => act(() => api(`/api/admin/plugins/${admin.id}`, { method: 'PUT', body: { route: e.target.value } }))}
            >
              <option value="direct">{T('Direct')}</option>
              <option value="proxy" disabled={!proxyConfigured}>
                {T('Through the China proxy')}
              </option>
              <option value="global" disabled={!globalProxyConfigured}>
                {T('Through the overseas proxy')}
              </option>
            </select>
            <button className="btn" disabled={busy} onClick={() => act(async () => {
              const r = await api<{ host: string; status: number; ms: number; exit?: string }>(`/api/admin/plugins/${admin.id}/network-test`, { body: {} })
              useApp.getState().say(`${r.host} HTTP ${r.status} · ${r.ms} ms${r.exit ? ` · ${r.exit}` : ''}`)
            })}>
              {T('Test the Network')}
            </button>
            {!proxyConfigured && !globalProxyConfigured && (
              <span className="muted" style={{ fontSize: 'calc(12px * var(--fs))' }}>{T('No proxy is set (optional): CN_PROXY_URL or GLOBAL_PROXY_URL in .env')}</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 'calc(12px * var(--fs))' }}>
            {T('It can reach')}: {admin.network.join(', ') || '—'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {admin.repo &&
              (update ? (
                <button className="btn primary" disabled={busy} onClick={() => act(async () => {
                  const p = await api<PluginPreview>('/api/admin/plugins/preview', { body: { source: admin.repo } })
                  await api('/api/admin/plugins/install', { body: { stagingId: p.stagingId } })
                  setUpdate(undefined)
                })}>
                  {T('Update')} {update}
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => act(async () => {
                  const r = await api<{ version: string | null }>(`/api/admin/plugins/${admin.id}/update`)
                  setUpdate(r.version)
                  if (!r.version) useApp.getState().say(T('Up to date'))
                })}>
                  {T('Check for Update')}
                </button>
              ))}
            <button className="btn" disabled={busy} onClick={() => act(() => api(`/api/admin/plugins/${admin.id}/reload`, { body: {} }))}>
              {T('Reload')}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'calc(13px * var(--fs))' }}>
              <Switch
                on={!admin.enabled}
                label={T('Off for everyone')}
                onChange={(off) => act(() => api(`/api/admin/plugins/${admin.id}`, { method: 'PUT', body: { enabled: !off } }))}
              />
              {T('Off for everyone')}
            </label>
            <span style={{ flex: 1 }} />
            {busy && <Spinner />}
            <button className="btn danger" onClick={() => setRemoving(true)}>
              {T('Remove')}
            </button>
          </div>
        </div>
      )}
      {removing && admin && (
        <Confirm
          title={Tf('Remove %s?', name)}
          text={T('Remove this plugin and what everyone keeps in it?')}
          action={T('Remove')}
          onDone={(ok) => {
            setRemoving(false)
            if (ok) void act(() => api(`/api/admin/plugins/${admin.id}`, { method: 'DELETE' }))
          }}
        />
      )}
    </div>
  )
}

function SettingField({ source, k, label, help, link }: { source: SourceInfo; k: string; label: string; help?: string; link?: string }) {
  const [v, setV] = useState(source.values[k] ?? '')
  useEffect(() => setV(source.values[k] ?? ''), [source.values, k])
  const qc = useQueryClient()
  const save = async () => {
    if (v === (source.values[k] ?? '')) return
    try {
      await api(`/api/sources/${source.id}/settings`, { body: { key: k, value: v } })
      await useApp.getState().refreshSources()
      void qc.invalidateQueries({ queryKey: [source.id] })
    } catch (e) {
      useApp.getState().say(errorMessage(e))
    }
  }
  return (
    <div className="row col">
      <label>{label}</label>
      <input className="field" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      {help && <div className="help">{help}</div>}
      {link && (
        <div className="help">
          <a href={link} target="_blank" rel="noreferrer">
            {link}
          </a>
        </div>
      )}
    </div>
  )
}

function InstallDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<PluginPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const m = preview?.manifest
  return (
    <Dialog onClose={() => onDone(false)}>
      <h3>{T('Install Plugin')}</h3>
      {!preview ? (
        <>
          <input
            className="field"
            autoFocus
            placeholder="owner/repo · https://github.com/… · https://….zip"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && source.trim() && run(async () => setPreview(await api<PluginPreview>('/api/admin/plugins/preview', { body: { source } })))}
          />
          <p>{T('GitHub repository or zip address')}</p>
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            {T('Upload a zip')}
            <input
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void run(async () => setPreview(await api<PluginPreview>('/api/admin/plugins/upload', { raw: f, type: 'application/zip' })))
              }}
            />
          </label>
        </>
      ) : (
        <div className="group">
          <Row title={`${m!.name} ${m!.version ?? ''}`} sub={preview.replaces !== undefined ? `${T('Update')} ${preview.replaces} → ${m!.version}` : m!.id} />
          <Row title={T('It can reach')} sub={(m!.permissions?.network ?? []).join(', ') || '—'} />
          {m!.permissions?.process && <Row title="process" sub={T("The web version can't start programs on the server for a plugin")} />}
        </div>
      )}
      {error && <p style={{ color: 'var(--accent)' }}>{error}</p>}
      <div className="acts">
        {busy && <Spinner />}
        <button className="btn" onClick={() => onDone(false)}>
          {T('Cancel')}
        </button>
        {!preview ? (
          <button
            className="btn primary"
            disabled={!source.trim() || busy}
            onClick={() => run(async () => setPreview(await api<PluginPreview>('/api/admin/plugins/preview', { body: { source } })))}
          >
            {T('Next')}
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api('/api/admin/plugins/install', { body: { stagingId: preview.stagingId } })
                onDone(true)
              })
            }
          >
            {T('Install')}
          </button>
        )}
      </div>
    </Dialog>
  )
}

export { call }
