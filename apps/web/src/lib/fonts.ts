// Fonts: the antwen main site's pair by default (Poppins for Latin, MiSans for
// Chinese), each replaceable by a common font or any installed one by name.
// The bundled faces carry unicode-range, so a browser downloads only the slices
// of a font that's in use and has glyphs on the page.

import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/poppins/800.css'
import '@fontsource-variable/inter/wght.css'
import 'misans/lib/Normal/MiSansVF.min.css'

export interface FontPrefs {
  /** A key of LATIN_FONTS, or 'custom'. */
  fontLatin?: string
  fontLatinCustom?: string
  /** A key of CJK_FONTS, or 'custom'. */
  fontCjk?: string
  fontCjkCustom?: string
  /** Scale of every text size, 0.85–1.3. */
  fontScale?: number
  /** Extra letter spacing, em. */
  letterSpacing?: number
  /** A gap between Chinese and Latin letters or digits (CSS text-autospace). */
  cjkSpacing?: boolean
}

export interface FontChoice {
  label: string
  stack: string
}

export const LATIN_FONTS: Record<string, FontChoice> = {
  poppins: { label: 'Poppins (antwen)', stack: "'Poppins'" },
  inter: { label: 'Inter', stack: "'Inter Variable', 'Inter'" },
  system: { label: 'System Default', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI'" },
  segoe: { label: 'Segoe UI', stack: "'Segoe UI'" },
  sf: { label: 'SF Pro', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text'" },
  roboto: { label: 'Roboto', stack: "Roboto" },
  helvetica: { label: 'Helvetica / Arial', stack: "'Helvetica Neue', Helvetica, Arial" },
  verdana: { label: 'Verdana', stack: 'Verdana' },
  georgia: { label: 'Georgia (serif)', stack: 'Georgia' },
  times: { label: 'Times New Roman (serif)', stack: "'Times New Roman', Times" },
  mono: { label: 'Monospace', stack: "'JetBrains Mono', 'Cascadia Code', Consolas, Menlo, monospace" },
}

export const CJK_FONTS: Record<string, FontChoice> = {
  misans: { label: 'MiSans (antwen)', stack: "'MiSans VF'" },
  system: { label: 'System Default', stack: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC'" },
  pingfang: { label: 'PingFang', stack: "'PingFang SC'" },
  yahei: { label: 'Microsoft YaHei', stack: "'Microsoft YaHei', 微软雅黑" },
  noto: { label: 'Noto Sans SC', stack: "'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC', 'Source Han Sans CN'" },
  harmony: { label: 'HarmonyOS Sans', stack: "'HarmonyOS Sans SC', 'HarmonyOS Sans'" },
  dengxian: { label: 'DengXian', stack: "DengXian, 等线" },
  song: { label: 'Song / Noto Serif SC', stack: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', SimSun, 宋体" },
  kai: { label: 'Kaiti', stack: "'Kaiti SC', STKaiti, KaiTi, 楷体" },
}

export const FONT_DEFAULTS: Required<Pick<FontPrefs, 'fontLatin' | 'fontCjk' | 'fontScale' | 'letterSpacing' | 'cjkSpacing'>> = {
  fontLatin: 'poppins',
  fontCjk: 'misans',
  fontScale: 1,
  letterSpacing: 0,
  cjkSpacing: false,
}

const FALLBACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif"

/** A typed font name made safe to put in a font-family list: quoted, without the characters that would end it. */
function customStack(name: string | undefined): string | undefined {
  const names = (name ?? '')
    .split(/[,，]/)
    .map((n) => n.replace(/["'`;{}\\<>]/g, '').trim())
    .filter(Boolean)
    .slice(0, 4)
  return names.length ? names.map((n) => `'${n}'`).join(', ') : undefined
}

function pick(table: Record<string, FontChoice>, key: string | undefined, custom: string | undefined, fallbackKey: string) {
  if (key === 'custom') return customStack(custom) ?? table[fallbackKey].stack
  return (table[key ?? ''] ?? table[fallbackKey]).stack
}

/** The font-family list: the Latin font first, so it takes the letters and
 * digits; the Chinese font next, which the browser falls through to for CJK. */
export function fontStack(p: FontPrefs): string {
  const latin = pick(LATIN_FONTS, p.fontLatin, p.fontLatinCustom, FONT_DEFAULTS.fontLatin)
  const cjk = pick(CJK_FONTS, p.fontCjk, p.fontCjkCustom, FONT_DEFAULTS.fontCjk)
  return `${latin}, ${cjk}, ${FALLBACK}`
}

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d)

export function applyFonts(p: FontPrefs) {
  const root = document.documentElement.style
  root.setProperty('--font', fontStack(p))
  root.setProperty('--fs', String(clamp(p.fontScale, 0.85, 1.3, 1)))
  root.setProperty('--ls', `${clamp(p.letterSpacing, -0.05, 0.2, 0)}em`)
  document.documentElement.dataset.cjkSpacing = p.cjkSpacing ? 'on' : 'off'
}

/** Whether this browser can put the gap between Chinese and Latin text. */
export const cjkSpacingSupported = typeof CSS !== 'undefined' && CSS.supports('text-autospace', 'normal')
