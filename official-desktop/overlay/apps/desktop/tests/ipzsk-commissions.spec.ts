import { describe, expect, it } from 'vitest'
import { parseIpzskCommissions } from '../src/ipzsk-commissions.ts'

const fixture = () => ({ profile: { bd_active: false }, referrals: 0,
  invitation_url: 'https://api.ipzsk.com/api/account/referral/' + 'a'.repeat(32),
  balance: { total_cny: '-0.00000001', available_cny: '0.00000000', withdrawable_cny: '0.00000000', frozen: true },
  ledger: [], payouts: [], conversions: [] })

describe('account earnings boundary', () => {
  it('preserves small negative adjustments and frozen status', () => {
    expect(parseIpzskCommissions(fixture()).balance).toEqual(fixture().balance)
  })
  it.each([NaN, Infinity, null, 12, 'NaN', '1e8', '1.000000001', '9999999999999'])('rejects invalid money %s', amount => {
    const data = fixture()
    expect(() => parseIpzskCommissions({ ...data, balance: { ...data.balance, total_cny: amount } })).toThrow()
  })
  it('rejects external invitation URLs, unbounded lists and unknown statuses', () => {
    expect(() => parseIpzskCommissions({ ...fixture(), invitation_url: 'https://attacker.invalid' })).toThrow()
    expect(() => parseIpzskCommissions({ ...fixture(), ledger: Array(101).fill({}) })).toThrow()
    expect(() => parseIpzskCommissions({ ...fixture(), payouts: [{ id: '00000000-0000-0000-0000-000000000000', state: 'unknown' }] })).toThrow()
  })
})
