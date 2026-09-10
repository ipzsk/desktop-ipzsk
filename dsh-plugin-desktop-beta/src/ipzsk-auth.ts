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
/** One canonical parameter the gateway accepts for a media model. Field names are gateway-side
 *  (prompt / aspect_ratio / resolution / duration / enhance_prompt), never the upstream vendor's. */
export interface IpzskModelParam {
  readonly field: string; readonly type: string; readonly values?: string[]
  readonly default?: string | number | boolean | null; readonly required?: boolean
  readonly min?: number; readonly max?: number; readonly unit?: string
}
export interface IpzskMediaModel {
  readonly id: string; readonly name: string
  readonly params?: IpzskModelParam[]
  /** field -> why this model refuses it, ready to show the user. */
  readonly unsupported?: Record<string, string>
  /** Deprecated: kept only so older builds keep booting; read params instead. Absent on models
   *  that expose no aspect ratio at all (z-image-turbo), which is why neither may be required. */
  readonly sizes?: string[]; readonly default_size?: string
}
export type IpzskImageModel = IpzskMediaModel
export interface IpzskModels {
  readonly default_model: string; readonly models: IpzskModel[]
  readonly image_models?: IpzskMediaModel[]; readonly video_models?: IpzskMediaModel[]
  readonly canonical_params?: Record<string, string>
  readonly plugin_configs?: IpzskPluginConfig[]
}

export interface IpzskCustomer { readonly id: string; readonly email: string }

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

  async pluginMarket(): Promise<unknown> { return this.api('/api/me/plugin-market') }

  models(): IpzskModels {
    if (!this.modelSettings) throw new Error('模型服务尚未连接，请重新登录。')
    return this.modelSettings
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
      token?: unknown; default_model?: unknown; models?: IpzskModel[]
      image_models?: IpzskMediaModel[]; video_models?: IpzskMediaModel[]
      canonical_params?: Record<string, string>; plugin_configs?: unknown
    }
    if (typeof config.token !== 'string' || !/^ipz_[A-Za-z0-9_-]{43}$/u.test(config.token)
      || typeof config.default_model !== 'string' || !Array.isArray(config.models) || !config.models.length
      || config.models.some(model => typeof model.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/u.test(model.id)
        || typeof model.name !== 'string' || !Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1
        || !Number.isSafeInteger(model.maxTokens) || model.maxTokens < 1)
      || !config.models.some(model => model.id === config.default_model)) {
      throw new Error('后台模型配置异常，请联系管理员。')
    }
    // Media models are validated on identity only. Their parameters are whatever the gateway
    // says they are: a model with no aspect ratio (z-image-turbo) or no resolution is legal, and
    // demanding sizes here would lock this client out the moment such a model is opened upstream.
    const badMedia = (list?: IpzskMediaModel[]) => list !== undefined && (!Array.isArray(list) || list.some(model =>
      !model || typeof model.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/u.test(model.id)
      || typeof model.name !== 'string' || !model.name
      || (model.params !== undefined && (!Array.isArray(model.params)
        || model.params.some(param => !param || typeof param.field !== 'string' || typeof param.type !== 'string')))))
    if (badMedia(config.image_models)) throw new Error('后台图片模型配置异常。')
    if (badMedia(config.video_models)) throw new Error('后台视频模型配置异常。')
    this.modelToken = config.token
    this.modelSettings = { default_model: config.default_model, models: config.models,
      image_models: config.image_models ?? [], video_models: config.video_models ?? [],
      ...(config.canonical_params === undefined ? {} : { canonical_params: config.canonical_params }),
      plugin_configs: parseIpzskPluginConfigs(config.plugin_configs) }
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
