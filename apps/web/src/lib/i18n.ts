// The app's text, by its English, as MyGo Music's internal/i18n has it: the
// Chinese comes from its zh_cn.go, with the web version's own lines after.

import zhApp from './zh-CN.json'
import { useApp } from '../store/app.ts'

export type Lang = 'en' | 'zh-CN'

const zhWeb: Record<string, string> = {
  // Fonts
  Font: '字体',
  'English Font': '英文字体',
  'Chinese Font': '中文字体',
  'Letters and digits use the English font; Chinese falls through to the Chinese one':
    '字母和数字用英文字体，中文用中文字体',
  'Custom…': '自定义…',
  'Font name installed on this device, e.g. JetBrains Mono': '本机已安装的字体名，例如 JetBrains Mono',
  'Font name installed on this device, e.g. LXGW WenKai': '本机已安装的字体名，例如 霞鹜文楷',
  'Font Size': '字体大小',
  'Letter Spacing': '字间距',
  'Space Between Chinese and English': '中英文间距',
  'A small gap between Chinese and Latin letters or digits': '在中文与英文、数字之间自动留出约 1/8 字宽的空隙',
  "This browser doesn't support it yet (Chrome / Edge 140+)": '当前浏览器暂不支持（需 Chrome / Edge 140 及以上）',
  'Reset Fonts': '恢复默认',
  'Poppins (antwen)': 'Poppins（主站）',
  'MiSans (antwen)': 'MiSans（主站）',
  'System Default': '系统默认',
  'Georgia (serif)': 'Georgia（衬线）',
  'Times New Roman (serif)': 'Times New Roman（衬线）',
  Monospace: '等宽',
  PingFang: '苹方',
  'Microsoft YaHei': '微软雅黑',
  'Noto Sans SC': '思源黑体',
  DengXian: '等线',
  'Song / Noto Serif SC': '宋体 / 思源宋体',
  Kaiti: '楷体',
  'Sign in with antwen': '使用 antwen 账号登录',
  'Sign out of antwen music': '退出 antwen music',
  'Install Plugin': '安装插件',
  'GitHub repository or zip address': 'GitHub 仓库或 zip 地址',
  'Upload a zip': '上传 zip',
  Install: '安装',
  Update: '更新',
  Reload: '重新加载',
  'Check for Update': '检查更新',
  'Up to date': '已是最新',
  'Network Route': '出网方式',
  Direct: '直连',
  'Through the China proxy': '经国内代理',
  'Test the Proxy': '测试代理',
  'No China proxy is set: put CN_PROXY_URL in .env': '未配置国内代理（可选），所有插件直连；需要时在 .env 中设置 CN_PROXY_URL',
  'Off for everyone': '对所有人停用',
  'It can reach': '可访问',
  'Remove this plugin and what everyone keeps in it?': '删除此插件，以及所有人在其中保存的数据？',
  Admin: '管理',
  'Finish Signing In': '完成登录',
  'Sign in on the page that opened, then paste the cookies of {host} here.': '请在打开的页面中登录，然后将 {host} 的 Cookie 粘贴到这里。',
  'Open the Sign-in Page': '打开登录页',
  'The cookies it needs': '需要的 Cookie',
  'After signing in, the page goes to an address that fails to load. Paste that address here.':
    '登录后页面会跳转到一个打不开的地址，请把那个地址粘贴到这里。',
  Done: '完成',
  'Opened in a new tab': '已在新标签页打开',
  'Plays on': '播放于',
  Account: '账号',
  'Signed in to antwen as %s': '已用 antwen 账号 %s 登录',
  'Copied': '已复制',
  'Nothing to play': '没有可播放的歌曲',
  'Play Next': '下一首播放',
  'Add to Queue': '添加到待播清单',
  'Go to Album': '查看专辑',
  'Go to Artist': '查看歌手',
  'Copy Link': '复制链接',
  'Remove from Playlist': '从歌单中移除',
  'Open in Browser': '在浏览器中打开',
  'Clear': '清空',
  'Unlike': '取消喜欢',
  'Like': '喜欢',
  'Add a comment…': '发表评论…',
  'Added to': '已添加到',
  'Ask an admin to install a plugin.': '请联系管理员安装插件。',
  'Delete “%s”?': '删除“%s”？',
  'Delete…': '删除…',
  'Install a plugin to start listening.': '安装一个插件，开始听歌。',
  'Leave Station': '退出电台',
  'No Results': '没有结果',
  'No liked songs yet': '还没有喜欢的歌曲',
  'No plugins yet': '还没有插件',
  'No podcasts yet': '还没有播客',
  'No saved albums yet': '还没有收藏的专辑',
  'No songs yet': '还没有歌曲',
  'No stations': '没有电台',
  'Not signed in': '未登录',
  'Nothing found for “%s”': '没有找到“%s”',
  'Nothing up next': '待播清单为空',
  'Rename': '重命名',
  'Show or hide': '展开或收起',
  'Signed in': '已登录',
  'Signing in…': '正在登录…',
  "The web version can't start programs on the server for a plugin": '网页版不能在服务器上为插件启动程序',
  'Try Again': '重试',
  'Unable to play this': '无法播放',
  'Remove %s?': '移除 %s？',
  Next: '下一步',
  'Install %s': '安装%s',
  'NetEase Cloud Music': '网易云音乐',
  'Other Plugins…': '其他插件…',
  Menu: '菜单',
  'Through the overseas proxy': '经海外代理',
  'Test the Network': '测试网络',
  'No proxy is set (optional): CN_PROXY_URL or GLOBAL_PROXY_URL in .env': '未配置代理（可选），需要时在 .env 设置 CN_PROXY_URL 或 GLOBAL_PROXY_URL',
  'Open the sign-in page and approve.': '打开登录页并同意授权。',
  'The browser then goes to %s, which fails to load: that is expected.': '之后浏览器会跳到 %s，页面打不开是正常的。',
  'Copy the whole address from the address bar and paste it here.': '把地址栏里的完整地址复制下来，粘贴到这里。',
  'No devices: open Spotify on a phone or computer': '没有可用设备：先在手机或电脑上打开 Spotify',
}

const zh: Record<string, string> = { ...(zhApp as Record<string, string>), ...zhWeb }

let current: Lang = 'zh-CN'
export function setLanguage(l: Lang) {
  current = l
  document.documentElement.lang = l
}
export const language = () => current

/** Re-renders a component as the language changes. */
export function useLang() {
  return useApp((s) => s.prefs.language)
}

export function T(text: string): string {
  return current === 'zh-CN' ? zh[text] || text : text
}

/** Tf formats a text the way Go's fmt does, after translating it. */
export function Tf(text: string, ...args: unknown[]): string {
  let i = 0
  return T(text).replace(/%(\.\d+)?([dsfv%])/g, (_, prec: string | undefined, verb: string) => {
    if (verb === '%') return '%'
    const a = args[i++]
    if (verb === 'f') return Number(a).toFixed(prec ? Number(prec.slice(1)) : 6)
    if (verb === 'd') return String(Math.trunc(Number(a)))
    return String(a)
  })
}

/** A plugin's own text, by its locales. */
export function PT(locales: Record<string, Record<string, string>> | undefined, text: string): string {
  if (!text) return text
  return (current === 'zh-CN' && locales?.['zh-CN']?.[text]) || text
}

export function date(d: Date) {
  if (current === 'zh-CN') return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getDate()}`
}

export function today(d = new Date()) {
  if (current === 'zh-CN') return `${date(d)} ${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()]}`
  return `${d.toLocaleString('en-US', { weekday: 'long' })}, ${date(d)}`
}

export function songs(n: number) {
  return n === 1 ? T('1 song') : Tf('%d songs', n)
}

export function count(n: number) {
  if (current === 'zh-CN') {
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
    if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
    return String(n)
  }
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function ago(t: number, now = Date.now()) {
  const d = now - t
  const m = 60_000
  const h = 60 * m
  if (d < m) return T('just now')
  if (d < 2 * m) return T('a minute ago')
  if (d < h) return Tf('%d minutes ago', d / m)
  if (d < 2 * h) return T('an hour ago')
  if (d < 24 * h) return Tf('%d hours ago', d / h)
  if (d < 48 * h) return T('yesterday')
  if (d < 30 * 24 * h) return Tf('%d days ago', d / (24 * h))
  const td = new Date(t)
  if (td.getFullYear() === new Date(now).getFullYear()) return date(td)
  return td.toISOString().slice(0, 10)
}

export function greeting(d = new Date()) {
  const h = d.getHours()
  if (h < 5) return T('Good night')
  if (h < 12) return T('Good morning')
  if (h < 18) return T('Good afternoon')
  return T('Good evening')
}

/** A time in minutes and seconds, as players show it. */
export function clock(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}
