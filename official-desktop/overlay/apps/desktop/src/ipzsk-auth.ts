import { parseIpzskPluginConfigs, type IpzskPluginConfig } from './ipzsk-plugin-config.ts'
/** Account login and automatic, session-bound desktop model access. */
export const IPZSK_ORIGIN = 'https://api.ipzsk.com'

export interface IpzskSessionStore {
  canRemember(): boolean
  read(): string | undefined
  write(cookie: string): void
  clear(): void
}

export interface IpzskModel { readonly id: string; readonly name: string; readonly contextWindow: number; readonly maxTokens: number }
export interface IpzskImageModel { readonly id: string; readonly name: string; readonly sizes: string[]; readonly default_size: string }
export interface IpzskModels { readonly default_model: string; readonly models: IpzskModel[]; readonly image_models?: IpzskImageModel[]; readonly plugin_configs?: IpzskPluginConfig[] }

export interface IpzskCustomer { readonly id: string; readonly email: string }

/** Private Electron-to-Host payload; never expose it to a Renderer. */
export interface IpzskDesktopBootstrap extends IpzskModels {
  readonly version: 1
  readonly token: string
}

const SESSION_COOKIE = /^(?:__Secure-)?ipzsk_customer\.session_token=[^;\s\r\n]+$/u

export class IpzskAuthError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export class IpzskAuth {
  private cookie = ''
  private remember = false
  private modelToken = ''
  private modelSettings: IpzskModels | undefined

  constructor(private readonly store: IpzskSessionStore, private readonly request = fetch) {}

  private async api(path: string, body?: object): Promise<unknown> {
    let response: Response
    try {
      response = await this.request(IPZSK_ORIGIN + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: IPZSK_ORIGIN,
          'Content-Type': 'application/json',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new IpzskAuthError(0, '无法连接 IPZSK 后台，请检查网络后重试。')
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: '邮箱或密码无效，请检查后重试。',
        402: '点数不足，请先使用充值码充值。',
        401: '登录已失效，或邮箱密码错误，请重新登录。',
        403: '请确认邮箱已验证、账户可用；如访问已撤销，请重新登录。',
        429: '操作太频繁，请稍后重试。',
        503: '后台服务或可用模型尚未就绪，请稍后重试。',
      }
      throw new IpzskAuthError(response.status, messages[response.status] ?? '后台服务暂时不可用，请稍后重试。')
    }
    for (const header of response.headers.getSetCookie()) {
      const cookie = header.split(';')[0] ?? ''
      if (SESSION_COOKIE.test(cookie)) this.cookie = cookie
    }
    try { return await response.json() } catch {
      throw new Error('后台响应格式异常，请稍后重试。')
    }
  }

  async ready(): Promise<boolean> {
    const status = await this.api('/api/account/status') as { password_login_ready?: unknown }
    return status.password_login_ready === true
  }

  async restore(): Promise<IpzskCustomer | undefined> {
    const saved = this.cookie || this.store.read()
    if (!saved) return undefined
    if (!SESSION_COOKIE.test(saved)) { this.store.clear(); return undefined }
    if (!this.cookie) this.remember = true
    this.cookie = saved
    try { return await this.profile() } catch (error) {
      if (error instanceof IpzskAuthError && [401, 403].includes(error.status)) {
        this.cookie = ''
        this.modelToken = ''
        this.modelSettings = undefined
        this.store.clear()
        return undefined
      }
      throw error
    }
  }

  async signIn(email: unknown, password: unknown, remember: boolean): Promise<IpzskCustomer> {
    const normalized = this.email(email)
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw new Error('请输入密码。')
    if (remember && !this.store.canRemember()) throw new Error('系统加密存储不可用，请取消“记住登录”后重试。')
    this.cookie = ''
    this.modelToken = ''
    this.modelSettings = undefined
    this.store.clear()
    this.remember = remember
    await this.api('/api/auth/sign-in/email', { email: normalized, password })
    if (!this.cookie) throw new Error('后台未返回有效的登录会话，请重试。')
    return await this.profile()
  }

  async billing(page = 1): Promise<unknown> {
    const [wallet, usage] = await Promise.all([this.api('/api/me/wallet'), this.api('/api/me/usage?page=' + page)])
    return { wallet, usage }
  }

  async redeem(code: string): Promise<unknown> {
    return this.api('/api/me/vouchers/redeem', { code })
  }

  async messageBilling(responseIds: string[]): Promise<unknown> {
    return this.api('/api/me/message-billing', { response_ids: responseIds })
  }

  async pluginMarket(): Promise<unknown> { return this.api('/api/me/plugin-market') }
  async commissions(): Promise<unknown> { return this.api('/api/me/commissions') }

  models(): IpzskModels {
    if (!this.modelSettings) throw new Error('模型服务尚未连接，请重新登录。')
    return this.modelSettings
  }

  bootstrap(): IpzskDesktopBootstrap {
    return structuredClone({ version: 1, token: this.credential(), ...this.models() })
  }

  credential(): string {
    if (!this.modelToken) throw new Error('登录已失效，请重新登录 IPZSK。')
    return this.modelToken
  }

  private async profile(): Promise<IpzskCustomer> {
    const result = await this.api('/api/me/profile') as { user?: { id?: unknown; email?: unknown } }
    if (typeof result.user?.id !== 'string' || typeof result.user.email !== 'string') {
      throw new Error('后台账户数据异常，请联系管理员。')
    }
    if (this.remember) this.store.write(this.cookie)
    const config = await this.api('/api/me/desktop/bootstrap', {}) as {
      token?: unknown; default_model?: unknown; models?: IpzskModel[]; image_models?: IpzskImageModel[]; plugin_configs?: unknown
    }
    if (typeof config.token !== 'string' || !/^ipz_[A-Za-z0-9_-]{43}$/u.test(config.token)
      || typeof config.default_model !== 'string' || !Array.isArray(config.models) || !config.models.length || config.models.length > 256
      || config.models.some(model => !model || typeof model.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/u.test(model.id)
        || typeof model.name !== 'string' || !model.name || model.name.length > 256 || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1
        || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1)
      || !config.models.some(model => model.id === config.default_model)
      || new Set(config.models.map(model => model.id)).size !== config.models.length) {
      throw new Error('后台模型配置异常，请联系管理员。')
    }
    if (config.image_models !== undefined && (!Array.isArray(config.image_models) || config.image_models.length > 100 || config.image_models.some(model =>
      !model || typeof model.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/u.test(model.id)
      || typeof model.name !== 'string' || !model.name || model.name.length > 256 || !Array.isArray(model.sizes) || !model.sizes.length || model.sizes.length > 100
      || model.sizes.some(size => typeof size !== 'string' || !size || size.length > 32)
      || !model.sizes.includes(model.default_size)))) throw new Error('后台图片模型配置异常。')
    this.modelToken = config.token
    this.modelSettings = { default_model: config.default_model, models: config.models.map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens })), image_models: config.image_models ?? [], plugin_configs: parseIpzskPluginConfigs(config.plugin_configs) }
    return { id: result.user.id, email: result.user.email }
  }

  async signOut(): Promise<void> {
    // Always forget this device even if the server is temporarily unreachable.
    this.store.clear()
    this.modelToken = ''
    this.modelSettings = undefined
    try { await this.api('/api/auth/sign-out', {}) } finally { this.cookie = ''; this.remember = false }
  }

  private email(value: unknown): string {
    if (typeof value !== 'string') throw new Error('请输入有效邮箱。')
    const normalized = value.trim().toLowerCase()
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) throw new Error('请输入有效邮箱。')
    return normalized
  }
}
