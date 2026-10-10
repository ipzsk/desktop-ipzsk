/** Account-only operations exposed to the isolated, local account document. */
export const IPZSK_ACCOUNT_IPC = 'ipzsk-desktop:account'

export interface IpzskAccountState {
  readonly signedIn: boolean
  readonly email: string
  readonly canRemember: boolean
}

export interface IpzskBillingRow {
  readonly id: string
  readonly model: string
  readonly created_at: string | null
  readonly charged_points: string | null
  readonly billing_state: string | null
  readonly input_tokens: number | null
  readonly output_tokens: number | null
}

export interface IpzskAccountBill {
  readonly wallet: { readonly available_points: string; readonly frozen_points: string }
  readonly usage: { readonly page: number; readonly count: number; readonly page_size: number; readonly rows: IpzskBillingRow[] }
}

export type IpzskAccountRequest = { readonly type: 'state' | 'signOut' | 'accountSite' | 'commissions' | 'earningsSite' }
  | { readonly type: 'signIn'; readonly email: string; readonly password: string; readonly remember: boolean }
  | { readonly type: 'billing'; readonly page: number }
  | { readonly type: 'redeem'; readonly code: string }

export type IpzskAccountResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string }

export function parseIpzskAccountRequest(value: unknown): IpzskAccountRequest {
  const input = record(value)
  const keys = Object.keys(input).sort().join(',')
  if (keys === 'type' && ['state', 'signOut', 'accountSite', 'commissions', 'earningsSite'].includes(String(input.type))) return input as IpzskAccountRequest
  if (input.type === 'signIn' && keys === 'email,password,remember,type'
    && typeof input.email === 'string' && input.email.length <= 254
    && typeof input.password === 'string' && input.password.length > 0 && input.password.length <= 128
    && typeof input.remember === 'boolean') return input as IpzskAccountRequest
  if (input.type === 'billing' && keys === 'page,type' && integer(input.page, 1, 100_000)) return input as IpzskAccountRequest
  if (input.type === 'redeem' && keys === 'code,type' && typeof input.code === 'string'
    && input.code.trim().length > 0 && input.code.length <= 100) return { type: 'redeem', code: input.code.trim() }
  throw new Error('账户请求无效。')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('后台账户数据异常。')
  return value as Record<string, unknown>
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function points(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/u.test(value) || value.length > 64) throw new Error('后台点数数据异常。')
  return value
}

/** Project allowlisted billing fields; server payloads cannot forward credentials. */
export function parseIpzskAccountBill(value: unknown): IpzskAccountBill {
  const root = record(value), wallet = record(root.wallet), usage = record(root.usage)
  if (!integer(usage.page, 1) || !integer(usage.count) || !integer(usage.page_size, 1, 1000)
    || !Array.isArray(usage.rows) || usage.rows.length > 1000) throw new Error('后台账单数据异常。')
  const rows = usage.rows.map(value => {
    const row = record(value)
    if (typeof row.id !== 'string' || typeof row.model !== 'string'
      || (row.created_at != null && typeof row.created_at !== 'string')
      || (row.billing_state != null && typeof row.billing_state !== 'string')
      || (row.input_tokens != null && !integer(row.input_tokens))
      || (row.output_tokens != null && !integer(row.output_tokens))) throw new Error('后台消费记录异常。')
    return {
      id: row.id, model: row.model,
      created_at: row.created_at as string | null | undefined ?? null,
      charged_points: row.charged_points == null ? null : points(row.charged_points),
      billing_state: row.billing_state as string | null | undefined ?? null,
      input_tokens: row.input_tokens as number | null | undefined ?? null,
      output_tokens: row.output_tokens as number | null | undefined ?? null,
    }
  })
  return {
    wallet: { available_points: points(wallet.available_points), frozen_points: points(wallet.frozen_points) },
    usage: { page: usage.page, count: usage.count, page_size: usage.page_size, rows },
  }
}

export function parseIpzskRedemption(value: unknown): { amount_points: string; replayed: boolean } {
  const row = record(value)
  if (typeof row.replayed !== 'boolean') throw new Error('后台充值数据异常，请刷新余额核对。')
  return { amount_points: points(row.amount_points), replayed: row.replayed }
}
