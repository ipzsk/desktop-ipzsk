import { expect, it, vi } from 'vitest'
import { IpzskMarketService, type IpzskMarketOptions } from '../src/ipzsk-market-service.ts'
import { marketFixture } from './ipzsk-market-fixture.ts'
import { pluginInstallState } from '../src/ipzsk-market-approved.ts'

function setup() {
  const { plugin, bytes } = marketFixture()
  const options: IpzskMarketOptions = { manager: { listPlugins: () => [], installApproved: vi.fn(async () => {}) },
    hooks: { beforeChange: async () => {}, afterChange: async () => {} },
    catalog: vi.fn(async () => ({ market_id: 'dsh-ipzsk-market', plugins: [plugin] })), packaged: true,
    beforeInstall: vi.fn(async () => {}), afterInstall: vi.fn(async () => {}), onInstallError: vi.fn(async () => {}) }
  const request = vi.fn(async () => new Response(new Uint8Array(bytes)))
  return { plugin, bytes, options, request, service: new IpzskMarketService(options, request) }
}
it('installs only IDs resolved by the account authority and rechecks after downloading', async () => {
  const { service, plugin, bytes, options, request } = setup()
  await service.install(plugin.id, plugin.release_id)
  expect(options.catalog).toHaveBeenCalledTimes(2)
  expect(request).toHaveBeenCalledOnce()
  expect(options.manager.installApproved).toHaveBeenCalledWith(plugin, bytes, options.hooks)
  expect(options.afterInstall).toHaveBeenCalledOnce()
})
it('rejects renderer-supplied URLs, stale releases, revocation, and incompatible archives without stopping the Host', async () => {
  const { service, plugin, options, request } = setup()
  await expect(service.install('https://github.com/unreviewed.tgz', plugin.release_id)).rejects.toThrow('请求无效')
  await expect(service.install(plugin.id, '33333333-3333-4333-8333-333333333333')).rejects.toThrow('下架')
  expect(request).not.toHaveBeenCalled()
  vi.mocked(options.catalog).mockResolvedValueOnce({ market_id: 'dsh-ipzsk-market', plugins: [plugin] })
    .mockResolvedValueOnce({ market_id: 'dsh-ipzsk-market', plugins: [] })
  await expect(service.install(plugin.id, plugin.release_id)).rejects.toThrow('下架')
  expect(options.beforeInstall).not.toHaveBeenCalled()
  expect(options.manager.installApproved).not.toHaveBeenCalled()
  const old = marketFixture({ dsh: { bundle: { patch: './cordis.patch.yml' } } })
  vi.mocked(options.catalog).mockResolvedValue({ market_id: 'dsh-ipzsk-market', plugins: [old.plugin] })
  request.mockResolvedValue(new Response(new Uint8Array(old.bytes)))
  await expect(service.install(old.plugin.id, old.plugin.release_id)).rejects.toThrow('适配')
  expect(options.beforeInstall).not.toHaveBeenCalled()
})
it('passes package failures to official recovery without claiming rollback', async () => {
  const { service, plugin, options } = setup()
  const failure = new Error('pnpm failed')
  vi.mocked(options.manager.installApproved).mockRejectedValue(failure)
  await expect(service.install(plugin.id, plugin.release_id)).rejects.toThrow('恢复状态')
  expect(options.onInstallError).toHaveBeenCalledWith(failure)
  expect(options.afterInstall).not.toHaveBeenCalled()
})
it('does not begin a second market install during an active download', async () => {
  const { plugin, options, bytes } = setup()
  let release: ((response: Response) => void) | undefined
  const service = new IpzskMarketService(options, () => new Promise<Response>(resolve => { release = resolve }))
  const first = service.install(plugin.id, plugin.release_id)
  await vi.waitFor(() => expect(release).toBeDefined())
  await expect(service.install(plugin.id, plugin.release_id)).rejects.toThrow('另一项')
  release!(new Response(new Uint8Array(bytes)))
  await first
})

it('marks older approved releases behind installed preview betas and refuses a downgrade before downloading', async () => {
  for (const [name, available, installed] of [['dsh-doc-to-excel', '0.2.1', '0.3.0-beta.1'], ['@dickpy/dsh-imagegen', '1.7.0', '1.8.0-beta.1']]) {
    const { service, options, request } = setup()
    const { plugin } = marketFixture({ name, version: available })
    vi.mocked(options.catalog).mockResolvedValue({ market_id: 'dsh-ipzsk-market', plugins: [plugin] })
    options.manager.listPlugins = () => [{ name: name!, version: installed!, enabled: true }]
    expect((await service.catalog()).plugins[0]?.installState).toBe('ahead')
    await expect(service.install(plugin.id, plugin.release_id)).rejects.toThrow('阻止降级')
    expect(request).not.toHaveBeenCalled()
    expect(options.beforeInstall).not.toHaveBeenCalled()
    expect(options.manager.installApproved).not.toHaveBeenCalled()
  }
})

it('uses semantic release order for genuine upgrades, including beta-to-stable transitions', () => {
  expect(pluginInstallState(undefined, '0.3.0-beta.1')).toBe('install')
  expect(pluginInstallState('0.3.0-beta.1', '0.3.0-beta.1')).toBe('current')
  expect(pluginInstallState('0.3.0-beta.1', '0.3.0')).toBe('update')
  expect(pluginInstallState('1.8.0-beta.1', '1.8.0-beta.2')).toBe('update')
  expect(pluginInstallState('1.10.0', '1.9.0')).toBe('ahead')
})
