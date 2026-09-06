import { shell, type BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { createDesktopLocalWindow } from './local-window-policy.ts'
import { revealApplication } from './electron-reveal.ts'
import type { IpzskAuth, IpzskCustomer } from './ipzsk-auth.ts'

const DOCUMENT = fileURLToPath(new URL('./native-ui/ipzsk-login.html', import.meta.url))

/** Action URLs contain no email, password or session; only this local document is read. */
export function ipzskLoginAction(href: string): 'account' | 'login' | 'retry' | undefined {
  if (href === 'dsh-ipzsk-login://account') return 'account'
  if (href === 'dsh-ipzsk-login://login') return 'login'
  if (href === 'dsh-ipzsk-login://retry') return 'retry'
  return undefined
}

export class IpzskLoginWindow {
  private window: BrowserWindow | undefined
  constructor(private readonly auth: IpzskAuth) {}

  show(): void {
    if (this.window && !this.window.isDestroyed()) revealApplication(this.window, process.platform)
  }

  async run(): Promise<IpzskCustomer | undefined> {
    const window = createDesktopLocalWindow({
      partition: 'dsh-ipzsk-login', title: '登录 IPZSK', width: 480, height: 650,
      resizable: false, maximizable: false, fullscreenable: false,
      show: true, autoHideMenuBar: true, backgroundColor: '#f6f7fb',
    })
    window.removeMenu()
    this.window = window
    return await new Promise((resolve, reject) => {
      let settled = false
      let busy = false
      const finish = (customer?: IpzskCustomer): void => {
        if (settled) return
        settled = true
        this.window = undefined
        resolve(customer)
        if (!window.isDestroyed()) window.destroy()
      }
      const publish = async (message: string, sent = false): Promise<void> => {
        if (settled || window.isDestroyed()) return
        await window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('ipzsk-status', { detail: ${JSON.stringify({ message, sent })} }))`)
      }
      const perform = async (action: 'account' | 'login' | 'retry'): Promise<void> => {
        if (busy || settled) return
        busy = true
        try {
          if (action === 'account') {
            await shell.openExternal('https://www.ipzsk.com/account')
            await publish('请在网站完成注册或找回密码，然后返回登录。')
            return
          }
          if (action === 'retry') {
            const customer = await this.auth.restore()
            if (settled) return
            if (customer) { finish(customer); return }
            await publish(await this.auth.ready() ? '使用 IPZSK 邮箱和密码登录，模型服务将自动连接。' : '后台登录服务尚未就绪，请稍后重试。')
            return
          }
          const input: { email?: unknown; password?: unknown; remember?: unknown } = await window.webContents.executeJavaScript(
            `({email:document.getElementById('email').value,password:document.getElementById('password').value,remember:document.getElementById('remember').checked})`,
          )
          if (settled) return
          const customer = await this.auth.signIn(input.email, input.password, input.remember === true)
          await window.webContents.executeJavaScript("document.getElementById('password').value = ''")
          finish(customer)
        } catch (error) {
          await publish(error instanceof Error ? error.message : '登录失败，请重试。')
        } finally { busy = false }
      }
      window.webContents.on('will-navigate', (event, href) => {
        event.preventDefault()
        const action = ipzskLoginAction(href)
        if (action) void perform(action).catch(() => finish())
      })
      window.webContents.on('will-redirect', event => event.preventDefault())
      window.once('closed', () => finish())
      void window.loadFile(DOCUMENT).catch(() => {
        if (settled) return
        settled = true
        this.window = undefined
        if (!window.isDestroyed()) window.destroy()
        reject(new Error('无法加载 IPZSK 登录页面。'))
      })
    })
  }
}
