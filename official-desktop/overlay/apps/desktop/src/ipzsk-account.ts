import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IpzskAuth, type IpzskCustomer, type IpzskDesktopBootstrap } from './ipzsk-auth.ts'
import { ipzskSessionStore } from './ipzsk-session-store.ts'
import {
  IPZSK_ACCOUNT_IPC, parseIpzskAccountBill, parseIpzskAccountRequest, parseIpzskRedemption,
  type IpzskAccountResult, type IpzskAccountState,
} from './ipzsk-account-api.ts'

export interface IpzskAccountOptions {
  readonly userDataDir: string
  /** Stop the child Host and quit the application after local sign-out. */
  readonly onSignOut: () => Promise<void>
}

/** A dedicated file window owns the entire login and billing surface. */
export class IpzskAccountController {
  private readonly store
  private readonly auth: IpzskAuth
  private readonly documentPath: string
  private readonly documentUrl: string
  private window: BrowserWindow | undefined
  private customer: IpzskCustomer | undefined
  private initialized = false
  private disposed = false
  private mutating = false
  private login: Promise<boolean> | undefined
  private finishLogin: ((signedIn: boolean) => void) | undefined

  constructor(private readonly options: IpzskAccountOptions) {
    this.store = ipzskSessionStore(join(options.userDataDir, 'ipzsk', 'session.enc'))
    this.auth = new IpzskAuth(this.store)
    this.documentPath = join(app.getAppPath(), 'renderer', 'ipzsk-account.html')
    this.documentUrl = pathToFileURL(this.documentPath).href
  }

  init(): void {
    if (this.disposed) throw new Error('IPZSK 账户窗口已关闭。')
    if (this.initialized) return
    ipcMain.handle(IPZSK_ACCOUNT_IPC, async (event, value: unknown): Promise<IpzskAccountResult> => {
      this.assertSender(event)
      try {
        return { ok: true, value: await this.handle(value) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '账户操作未完成，请稍后重试。' }
      }
    })
    this.initialized = true
  }

  ensureSignedIn(): Promise<boolean> {
    this.init()
    if (this.customer) return Promise.resolve(true)
    this.login ??= this.restoreOrLogin()
    return this.login
  }

  bootstrap(): IpzskDesktopBootstrap {
    if (!this.customer || this.disposed) throw new Error('请先登录 IPZSK。')
    return this.auth.bootstrap()
  }

  pluginMarket(): Promise<unknown> {
    if (!this.customer || this.disposed) return Promise.reject(new Error('请先登录 IPZSK。'))
    return this.auth.pluginMarket()
  }

  async openAccount(): Promise<void> {
    this.init()
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore()
      this.window.show()
      this.window.focus()
      return
    }
    const window = new BrowserWindow({
      title: 'IPZSK 账户', width: 900, height: 760, minWidth: 520, minHeight: 560,
      show: false, autoHideMenuBar: true, backgroundColor: '#f5f5f3',
      webPreferences: {
        preload: fileURLToPath(new URL('./ipzsk-preload.cjs', import.meta.url)),
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        partition: 'ipzsk-account',
      },
    })
    this.window = window
    window.removeMenu()
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => { event.preventDefault() })
    window.webContents.on('will-redirect', event => { event.preventDefault() })
    window.webContents.on('will-attach-webview', event => { event.preventDefault() })
    window.once('closed', () => {
      if (this.window === window) this.window = undefined
      this.finishLogin?.(this.customer !== undefined)
      this.finishLogin = undefined
    })
    try {
      await window.loadFile(this.documentPath)
      if (!window.isDestroyed()) window.show()
    } catch {
      if (!window.isDestroyed()) window.destroy()
      throw new Error('无法加载 IPZSK 账户页面。')
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.finishLogin?.(false)
    this.finishLogin = undefined
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = undefined
    if (this.initialized) ipcMain.removeHandler(IPZSK_ACCOUNT_IPC)
    this.initialized = false
  }

  private state(): IpzskAccountState {
    return { signedIn: this.customer !== undefined, email: this.customer?.email ?? '', canRemember: this.store.canRemember() }
  }

  private assertSender(event: IpcMainInvokeEvent): void {
    const owner = this.window
    if (this.disposed || !owner || owner.isDestroyed() || event.sender !== owner.webContents
      || event.senderFrame !== owner.webContents.mainFrame || event.senderFrame.url !== this.documentUrl) {
      throw new Error('IPZSK 拒绝来自非账户窗口的请求。')
    }
  }

  private async restoreOrLogin(): Promise<boolean> {
    try {
      this.customer = await this.auth.restore()
      if (this.disposed) return false
      if (this.customer) return true
    } catch {
      // The login document stays available for a deliberate retry after network failure.
    }
    if (this.disposed) return false
    const signedIn = new Promise<boolean>(resolve => { this.finishLogin = resolve })
    await this.openAccount()
    return signedIn
  }

  private async handle(value: unknown): Promise<unknown> {
    const request = parseIpzskAccountRequest(value)
    if (request.type === 'state') return this.state()
    if (request.type === 'accountSite') {
      await shell.openExternal('https://www.ipzsk.com/account')
      return null
    }
    if (request.type === 'billing') {
      if (!this.customer) throw new Error('请先登录 IPZSK。')
      return parseIpzskAccountBill(await this.auth.billing(request.page))
    }
    if (this.mutating) throw new Error('正在处理账户操作，请稍后再试。')
    this.mutating = true
    try {
      if (request.type === 'signIn') {
        if (this.customer) throw new Error('账户已登录。')
        const customer = await this.auth.signIn(request.email, request.password, request.remember)
        if (this.disposed || !this.window || this.window.isDestroyed()) return null
        this.customer = customer
        this.finishLogin?.(true)
        this.finishLogin = undefined
        this.window.hide()
        return this.state()
      }
      if (!this.customer) throw new Error('请先登录 IPZSK。')
      if (request.type === 'redeem') return parseIpzskRedemption(await this.auth.redeem(request.code))
      this.customer = undefined
      // signOut forgets the local credential synchronously before its first await.
      const signOut = this.auth.signOut().catch(() => undefined)
      await this.options.onSignOut()
      await signOut
      return null
    } finally { this.mutating = false }
  }
}
