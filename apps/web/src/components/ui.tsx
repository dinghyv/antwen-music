// The kit the views are made of, as MyGo Music's ui_kit.go has it.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../lib/icons.tsx'
import { useImage } from '../lib/image.ts'
import { T } from '../lib/i18n.ts'

export function IconButton({
  icon,
  size = 16,
  label,
  onClick,
  on,
  disabled,
  style,
  className,
}: {
  icon: IconName
  size?: number
  label: string
  onClick?: (e: React.MouseEvent) => void
  on?: boolean
  disabled?: boolean
  style?: CSSProperties
  className?: string
}) {
  return (
    <button
      className={`round-btn ${on ? 'on' : ''} ${className ?? ''}`}
      style={{ width: size + 16, height: size + 16, ...style }}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Pill({ icon, label, accent, onClick, disabled }: { icon?: IconName; label: string; accent?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className={`pill ${accent ? 'accent' : ''}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={14} />}
      {label}
    </button>
  )
}

export function Segmented<V extends string | number>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />
}

/** A picture of a source's, or a placeholder of the same size while it loads. */
export function Img({
  source,
  url,
  px,
  icon = 'note',
  iconSize,
  round,
  eager,
}: {
  source?: string
  url?: string
  px: number
  icon?: IconName
  iconSize?: number
  round?: boolean
  /** Loaded at once, for what's on screen as it opens, as Now Playing is. */
  eager?: boolean
}) {
  const src = useImage(source, url, px)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])
  return (
    <>
      {(!src || !loaded || failed) && (
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', borderRadius: round ? '50%' : undefined }}>
          <Icon name={icon} size={iconSize ?? Math.max(14, Math.round(px * 0.3))} />
        </span>
      )}
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ position: 'relative', opacity: loaded ? 1 : 0, transition: 'opacity 0.3s', display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </>
  )
}

export function Heading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="heading">
      {sub && <div className="sub">{sub}</div>}
      <h1>{title}</h1>
    </div>
  )
}

export function SectionTitle({ title, first, onMore, right }: { title?: string; first?: boolean; onMore?: () => void; right?: ReactNode }) {
  if (!title && !onMore && !right) return null
  return (
    <div className={`section-title ${first ? 'first' : ''}`}>
      <h2 className="one">{title}</h2>
      {right}
      {onMore && (
        <button className="see-all" onClick={onMore}>
          {T('See All')}
        </button>
      )}
    </div>
  )
}

export function Bars({ paused }: { paused?: boolean }) {
  return (
    <span className={`bars ${paused ? 'paused' : ''}`}>
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export function Spinner() {
  return <span className="spinner" />
}

/** A popover attached to an element or a point, closing on a click outside or Escape. */
export function Popover({
  anchor,
  at,
  onClose,
  children,
  className,
  place = 'below',
}: {
  anchor?: HTMLElement | null
  at?: { x: number; y: number }
  onClose: () => void
  children: ReactNode
  className?: string
  place?: 'below' | 'above' | 'right'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = 0
    let top = 0
    if (at) ((left = at.x), (top = at.y))
    else if (anchor) {
      const r = anchor.getBoundingClientRect()
      if (place === 'above') ((left = r.left + r.width / 2 - w / 2), (top = r.top - h - 8))
      else if (place === 'right') ((left = r.right + 4), (top = r.top - 5))
      else ((left = r.left), (top = r.bottom + 6))
    }
    left = Math.max(8, Math.min(left, innerWidth - w - 8))
    if (top + h > innerHeight - 8) top = at ? at.y - h : Math.max(8, innerHeight - h - 8)
    setPos({ left, top: Math.max(8, top) })
  }, [anchor, at, place])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const t = setTimeout(() => {
      addEventListener('mousedown', down)
      addEventListener('contextmenu', down)
    })
    addEventListener('keydown', key)
    addEventListener('blur', onClose)
    return () => {
      clearTimeout(t)
      removeEventListener('mousedown', down)
      removeEventListener('contextmenu', down)
      removeEventListener('keydown', key)
      removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} style={pos ? pos : { left: -9999, top: -9999 }}>
      {children}
    </div>,
    document.body,
  )
}

export interface MenuItem {
  label?: string
  icon?: IconName
  onClick?: () => void
  disabled?: boolean
  sep?: boolean
  heading?: string
  sub?: MenuItem[]
  check?: boolean
}

/** A menu of items, one of which may open a menu of its own beside it. */
export function Menu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<{ i: number; el: HTMLElement } | null>(null)
  return (
    <div className="menu" role="menu">
      {items.map((it, i) => {
        if (it.sep) return <div key={i} className="sep" />
        if (it.heading) return <div key={i} className="label">{it.heading}</div>
        return (
          <button
            key={i}
            className={`item ${open?.i === i ? 'hl' : ''}`}
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={(e) => setOpen(it.sub ? { i, el: e.currentTarget } : null)}
            onClick={(e) => {
              if (it.sub) return setOpen({ i, el: e.currentTarget })
              onClose()
              it.onClick?.()
            }}
          >
            {it.check !== undefined && <span style={{ width: 14, display: 'grid' }}>{it.check && <Icon name="check" size={14} />}</span>}
            {it.icon && <Icon name={it.icon} size={15} />}
            <span className="one">{it.label}</span>
            <span className="sp" />
            {it.sub && <Icon name="forward" size={13} />}
          </button>
        )
      })}
      {open && items[open.i].sub && (
        <Popover anchor={open.el} place="right" onClose={() => setOpen(null)} className="menu">
          <Menu items={items[open.i].sub!} onClose={onClose} />
        </Popover>
      )}
    </div>
  )
}

export function Dialog({ children, onClose, className }: { children: ReactNode; onClose?: () => void; className?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`dialog ${className ?? ''}`} role="dialog">
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** A dialog asking for a line of text, as naming a playlist. */
export function AskText({ title, initial = '', placeholder, action, onDone }: { title: string; initial?: string; placeholder?: string; action: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial)
  return (
    <Dialog onClose={() => onDone(null)}>
      <h3>{title}</h3>
      <input
        className="field"
        autoFocus
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && v.trim() && onDone(v.trim())}
      />
      <div className="acts">
        <button className="btn" onClick={() => onDone(null)}>
          {T('Cancel')}
        </button>
        <button className="btn primary" disabled={!v.trim()} onClick={() => onDone(v.trim())}>
          {action}
        </button>
      </div>
    </Dialog>
  )
}

export function Confirm({ title, text, action, onDone }: { title: string; text?: string; action: string; onDone: (ok: boolean) => void }) {
  return (
    <Dialog onClose={() => onDone(false)}>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      <div className="acts">
        <button className="btn" onClick={() => onDone(false)}>
          {T('Cancel')}
        </button>
        <button className="btn primary" autoFocus onClick={() => onDone(true)}>
          {action}
        </button>
      </div>
    </Dialog>
  )
}

export function Sk({ w, h, r, style }: { w?: number | string; h: number | string; r?: number; style?: CSSProperties }) {
  return <div className="sk" style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} />
}
