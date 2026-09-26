import { describe, expect, it } from 'vitest'
import { approvedCatalog, downloadApproved, isApprovedArchiveSpec, verifyArchive } from '../src/ipzsk-market-approved.ts'
import { marketFixture } from './ipzsk-market-fixture.ts'

const baseline = '0.1.7-rc.2'
describe('IPZSK reviewed artifact boundary', () => {
  it('accepts exact reviewed GitHub identities and blocks host packages or unpinned data', () => {
    const { plugin } = marketFixture()
    expect(approvedCatalog({ market_id: 'dsh-ipzsk-market', plugins: [plugin] })).toEqual([plugin])
    for (const change of [{ artifact_url: 'https://github.com/Other/plugin/releases/download/a/x.tgz' },
      { package_name: '@deepseek-ai/dsh' }, { package_name: 'dsh-plugin-desktop' }, { version: 'latest' },
      { sha256: '' }, { size_bytes: 50_000_001 }]) {
      expect(() => approvedCatalog({ market_id: 'dsh-ipzsk-market', plugins: [{ ...plugin, ...change }] })).toThrow()
    }
  })
  it('checks archive bytes, exact package identity, version and bundle path', () => {
    const { plugin, bytes } = marketFixture()
    verifyArchive(bytes, plugin, baseline)
    for (const change of [{ size_bytes: bytes.length + 1 }, { sha256: '0'.repeat(64) }, { package_name: 'other' }, { version: '0.2.0' }]) {
      expect(() => verifyArchive(bytes, { ...plugin, ...change }, baseline)).toThrow()
    }
    const unsafe = marketFixture({ dsh: { bundle: { patch: '../outside.yml' }, desktop: { transport: 'connection', minVersion: baseline } } })
    expect(() => verifyArchive(unsafe.bytes, unsafe.plugin, baseline)).toThrow('入口')
  })
  it('rejects missing desktop compatibility metadata and future APIs before installation', () => {
    for (const fields of [{ dsh: { bundle: { patch: './cordis.patch.yml' } } },
      { dsh: { bundle: { patch: './cordis.patch.yml' }, desktop: { transport: 'connection', minVersion: '0.2.0' } } }]) {
      const { plugin, bytes } = marketFixture(fields)
      expect(() => verifyArchive(bytes, plugin, baseline)).toThrow(/适配|webServer/u)
    }
  })
  it('never sends account credentials to artifact hosts and denies private redirects', async () => {
    const { plugin, bytes } = marketFixture()
    const request: typeof fetch = async (_url, init) => {
      expect(init?.headers).toBeUndefined()
      expect(init?.redirect).toBe('manual')
      return new Response(new Uint8Array(bytes))
    }
    expect(await downloadApproved(plugin, baseline, AbortSignal.timeout(1000), request)).toEqual(bytes)
    await expect(downloadApproved(plugin, baseline, AbortSignal.timeout(1000), async () => new Response(null,
      { status: 302, headers: { location: 'http://127.0.0.1/private' } }))).rejects.toThrow('跳转地址')
  })
  it('allows only profile-owned content-addressed file specs', () => {
    expect(isApprovedArchiveSpec(`file:.ipzsk-packages/${'a'.repeat(64)}.tgz`)).toBe(true)
    for (const spec of ['file:/tmp/plugin.tgz', 'file:../plugin.tgz', 'file:.ipzsk-packages/latest.tgz', 'https://example.test/x.tgz']) {
      expect(isApprovedArchiveSpec(spec)).toBe(false)
    }
  })
})
