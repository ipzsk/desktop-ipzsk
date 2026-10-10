function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('收益数据异常，请稍后刷新。')
  return value as Record<string, unknown>
}
function money(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d{1,12}(?:\.\d{1,8})?$/u.test(value)) throw new Error('收益金额异常。')
  return value
}
function time(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('收益时间异常。')
  return value
}
function rows(value: unknown, maximum: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('收益记录异常。')
  return value.map(object)
}

export function parseIpzskCommissions(value: unknown) {
  const data = object(value), balance = object(data.balance), profile = object(data.profile)
  if (typeof balance.frozen !== 'boolean' || typeof profile.bd_active !== 'boolean'
    || !Number.isSafeInteger(data.referrals) || Number(data.referrals) < 0
    || typeof data.invitation_url !== 'string' || !/^https:\/\/api\.ipzsk\.com\/api\/account\/referral\/[a-f0-9]{32}$/u.test(data.invitation_url)) throw new Error('收益账户数据异常。')
  const ledger = rows(data.ledger, 100).map(row => {
    if (typeof row.kind !== 'string' || !['bd', 'developer', 'invitation', 'conversion', 'payout'].includes(row.kind)) throw new Error('收益项目异常。')
    return { kind: row.kind, amount_cny: money(row.amount_cny), created_at: time(row.created_at), available_at: time(row.available_at) }
  })
  const operations = (value: unknown) => rows(value, 50).map(row => {
    if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/u.test(row.id) || typeof row.state !== 'string'
      || !['requested', 'approved', 'paid', 'cancelled', 'pending', 'applying', 'applied', 'review'].includes(row.state)) throw new Error('收益申请数据异常。')
    return { id: row.id, state: row.state, amount_cny: money(row.amount_cny), created_at: time(row.created_at) }
  })
  return { invitation_url: data.invitation_url, referrals: Number(data.referrals), bd_active: profile.bd_active,
    balance: { total_cny: money(balance.total_cny), available_cny: money(balance.available_cny), withdrawable_cny: money(balance.withdrawable_cny), frozen: balance.frozen },
    ledger, payouts: operations(data.payouts), conversions: operations(data.conversions) }
}
