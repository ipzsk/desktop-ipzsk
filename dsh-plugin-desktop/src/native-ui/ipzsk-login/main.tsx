import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

function Login() {
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('正在检查登录状态…')
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; sent: boolean }>).detail
      setMessage(detail.message)
      setBusy(false)
    }
    window.addEventListener('ipzsk-status', receive)
    window.location.href = 'dsh-ipzsk-login://retry'
    return () => { window.removeEventListener('ipzsk-status', receive) }
  }, [])
  const act = (action: 'account' | 'login' | 'retry') => {
    if (busy) return
    const email = document.getElementById('email') as HTMLInputElement
    const password = document.getElementById('password') as HTMLInputElement
    if (action === 'login' && !email.reportValidity()) return
    if (action === 'login' && !password.reportValidity()) return
    setBusy(true)
    setMessage('正在连接…')
    window.location.href = `dsh-ipzsk-login://${action}`
  }
  return <main>
    <div className="brand">IPZSK <span>DESKTOP</span></div>
    <h1>登录你的工作空间</h1>
    <p className="intro">使用 IPZSK 邮箱账户，连接你的云端服务。</p>
    <form onSubmit={event => { event.preventDefault(); act('login') }}>
      <label htmlFor="email">邮箱地址</label>
      <input id="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={busy} />
      <label htmlFor="password">密码</label>
      <input id="password" type="password" autoComplete="current-password" maxLength={128} placeholder="输入 IPZSK 账户密码" required disabled={busy} />
      <label className="remember"><input id="remember" type="checkbox" disabled={busy} />记住登录（本机加密保存）</label>
      <button className="primary" disabled={busy} type="submit">{busy ? '请稍候…' : '登录并进入'}</button>
    </form>
    <p role="status" aria-live="polite" className="status">{message}</p>
    <button className="retry" disabled={busy} onClick={() => act('retry')}>重新检查连接 / 已保存的登录</button>
    <button className="retry" disabled={busy} onClick={() => act('account')}>注册账号 / 找回密码</button>
    <footer>连接 api.ipzsk.com · 登录后自动连接模型服务<br />关闭此窗口将退出应用</footer>
  </main>
}

createRoot(document.getElementById('root')!).render(<Login />)
