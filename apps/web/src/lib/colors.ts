// A cover's colors, for Now Playing's backdrop and the daily card, as
// MyGo Music's backdrop.go and ui_daily.go take them from its tint.

import { useEffect, useState } from 'react'
import { viaServer, sized } from './image.ts'

export type RGB = [number, number, number]

export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max ? d / max : 0, max]
}

export function hsvColor(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `rgb(${Math.round((r + m) * 255)} ${Math.round((g + m) * 255)} ${Math.round((b + m) * 255)})`
}

const cache = new Map<string, Promise<RGB | null>>()

/** The tint of a picture: its average, leaning to its most colorful pixels. */
export function tintOf(src: string): Promise<RGB | null> {
  let p = cache.get(src)
  if (p) return p
  p = new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const n = 24
        const cv = document.createElement('canvas')
        cv.width = cv.height = n
        const ctx = cv.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(img, 0, 0, n, n)
        const d = ctx.getImageData(0, 0, n, n).data
        let r = 0, g = 0, b = 0, w = 0
        for (let i = 0; i < d.length; i += 4) {
          const [, s, v] = hsv(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
          const k = 0.15 + s * v * 2
          r += d[i] * k
          g += d[i + 1] * k
          b += d[i + 2] * k
          w += k
        }
        resolve([r / w, g / w, b / w])
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
  cache.set(src, p)
  return p
}

/** A cover's tint, fetched small through the server so the canvas can read it. */
export function useTint(source: string | undefined, url: string | undefined): RGB | null {
  const [tint, setTint] = useState<RGB | null>(null)
  useEffect(() => {
    const u = sized(url, 48)
    if (!u || !source) {
      setTint(null)
      return
    }
    let live = true
    void tintOf(viaServer(source, u)).then((t) => live && setTint(t))
    return () => {
      live = false
    }
  }, [source, url])
  return tint
}

/** Now Playing's backdrop: the cover's hue, deep, from top to foot. */
export function backdropColors(tint: RGB | null): [string, string] {
  if (!tint) return ['rgb(58 58 64)', 'rgb(32 32 36)']
  let [h, s] = hsv(tint[0] / 255, tint[1] / 255, tint[2] / 255)
  if (s > 0.12) s = Math.min(Math.max(s * 1.3, 0.45), 0.66)
  return [hsvColor(h, s, 0.35), hsvColor(h, Math.min(s * 1.05, 0.7), 0.24)]
}

/** The daily card's colors: deep, rich and the glow behind its record. */
export function dailyColors(tint: RGB | null): [string, string, string] {
  let h = 356
  let s = 0.74
  if (tint) {
    const [th, ts] = hsv(tint[0] / 255, tint[1] / 255, tint[2] / 255)
    if (ts > 0.15) ((h = th), (s = Math.min(Math.max(ts * 1.2, 0.5), 0.78)))
  }
  return [hsvColor(h, s, 0.24), hsvColor((h + 16) % 360, s * 0.9, 0.5), hsvColor((h + 32) % 360, s * 0.55, 1)]
}
