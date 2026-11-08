// The page shown to whoever isn't signed in: the name, and a button to sign in
// with an antwen (GTA 数据库) account. Nothing redirects until it's pressed.

import { useEffect } from 'react'

const SITE_ICON = 'https://www.antwen.cn/favicon.ico'

export function Login() {
  useEffect(() => {
    // Prefs (and with them the chosen appearance) load only after signing in.
    const dark = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => (document.documentElement.dataset.theme = dark.matches ? 'dark' : 'light')
    apply()
    dark.addEventListener('change', apply)
    document.title = '安稳音乐'
    return () => dark.removeEventListener('change', apply)
  }, [])
  const href = `/api/auth/login?return=${encodeURIComponent(location.pathname + location.search)}`
  return (
    <div className="login">
      <div className="login-box">
        <img className="login-logo" src="/icon.png" alt="" />
        <h1>安稳音乐</h1>
        <a className="login-btn" href={href}>
          <img src={SITE_ICON} alt="" width={20} height={20} />
          <span>使用安稳（GTA数据库）账号登录以使用</span>
        </a>
      </div>
    </div>
  )
}
