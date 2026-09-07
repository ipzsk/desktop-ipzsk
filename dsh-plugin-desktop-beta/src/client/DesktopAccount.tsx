import { useEffect, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'

export function DesktopAccount({ wide, api }: PropsRuntime<'sidebar.footer.action'> & { api: Pick<DesktopSettingsApi, 'read'> }) {
  const [email, setEmail] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void api.read().then(value => {
      if (active) { setEmail(value.account?.email ?? ''); setFailed(!value.account) }
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [api])
  const label = email || (failed ? '账号信息暂不可用' : '正在读取账号…')
  return <div title={label} aria-label={`IPZSK 账号：${label}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', minWidth: 0 }}>
    <span aria-hidden="true" style={{ flexShrink: 0 }}>◎</span>
    {wide && <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, opacity: .65 }}>{email ? '已登录 IPZSK' : 'IPZSK 账号'}</div>
      <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
    </div>}
  </div>
}
