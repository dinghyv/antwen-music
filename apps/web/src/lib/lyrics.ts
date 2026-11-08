// Timed lyrics, as MyGo Music's internal/lyrics reads them: LRC with its
// translation, or a source's own lines with the time of each word.

import type { Lyrics } from '@antwen-music/protocol'

export interface Word {
  text: string
  start: number
  end: number
}

export interface Line {
  at: number
  end: number
  text: string
  translation?: string
  words: Word[]
}

const lrcTime = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g

function parseLRC(lrc: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = []
  for (const raw of lrc.split('\n')) {
    const times = [...raw.matchAll(lrcTime)]
    if (!times.length) continue
    const last = times[times.length - 1]
    const text = raw.slice(last.index! + last[0].length).trim()
    for (const m of times) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0
      out.push({ at: Number(m[1]) * 60_000 + Number(m[2]) * 1000 + Math.round(frac * 1000), text })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Splits text into words, each CJK character one, sharing the time from start to end by their lengths. */
export function spreadWords(text: string, start: number, end: number): Word[] {
  const words: string[] = []
  let cur = ''
  const flush = () => {
    if (cur) words.push(cur)
    cur = ''
  }
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (cur) {
        cur += ' '
        flush()
      }
    } else if (cjk.test(ch)) {
      flush()
      words.push(ch)
    } else cur += ch
  }
  flush()
  if (!words.length) return []
  const total = words.reduce((n, w) => n + [...w.trim()].length, 0) || 1
  const span = (end - start) * 0.85
  let at = start
  return words.map((w) => {
    const d = (span * [...w.trim()].length) / total
    const word = { text: w, start: at, end: at + d }
    at += d
    return word
  })
}

export function build(lrc: string, translation: string): Line[] {
  const lines: Line[] = parseLRC(lrc)
    .filter((l) => l.text)
    .map((l) => ({ at: l.at, end: 0, text: l.text, words: [] }))
  lines.forEach((l, i) => {
    l.end = Math.min(l.at + 6000, lines[i + 1]?.at ?? Infinity)
    l.words = spreadWords(l.text, l.at, l.end)
  })
  for (const t of parseLRC(translation)) {
    if (!t.text) continue
    let best = -1
    let gap = 1500
    lines.forEach((l, i) => {
      const g = Math.abs(l.at - t.at)
      if (g < gap) ((best = i), (gap = g))
    })
    if (best >= 0 && !lines[best].translation) lines[best].translation = t.text
  }
  return lines
}

export function fromSource(l: Lyrics | null | undefined): Line[] {
  if (!l) return []
  if (!l.lines?.length) return build(l.lrc ?? '', l.translation ?? '')
  const out: Line[] = []
  for (const sl of l.lines) {
    let text = (sl.text ?? '').trim()
    if (!text) text = (sl.words ?? []).map((w) => w.text).join('').trim()
    if (!text) continue
    out.push({
      at: sl.start,
      end: sl.end ?? 0,
      text,
      translation: sl.translation,
      words: (sl.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end })),
    })
  }
  out.sort((a, b) => a.at - b.at)
  out.forEach((l, i) => {
    if (l.end <= l.at) l.end = Math.min(l.at + 6000, out[i + 1]?.at ?? Infinity)
    if (!l.words.length) l.words = spreadWords(l.text, l.at, l.end)
  })
  return out
}

/** The line sung at pos, or -1 before the first. */
export function indexAt(lines: Line[], pos: number): number {
  let lo = 0
  let hi = lines.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].at > pos) hi = mid
    else lo = mid + 1
  }
  return lo - 1
}

/** "ja" for lyrics with kana, whose kanji then take a Japanese font. */
export function lang(lines: Line[]): string | undefined {
  return lines.some((l) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(l.text.replace(/[ー・]/g, ''))) ? 'ja' : undefined
}

const creditNames = ['作词', '作曲', '编曲', '制作', '监制', '混音', '录音', '母带', '和声', '吉他', '贝斯', '鼓', '键盘', '弦乐', '出品', '发行', 'OP', 'SP', '词', '曲', 'Lyrics', 'Music', 'Composer', 'Arranger', 'Producer']

export function isCredit(text: string) {
  const i = text.search(/[:：]/)
  if (i <= 0 || [...text.slice(0, i)].length > 12) return false
  const head = text.slice(0, i).trim()
  return creditNames.some((n) => head === n || ([...n].length > 1 && head.startsWith(n)))
}
