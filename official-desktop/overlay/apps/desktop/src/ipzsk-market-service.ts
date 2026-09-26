/** Main-process catalog authority and reviewed install orchestration. */
import { approvedCatalog, assertPluginUpgrade, downloadApproved, pluginInstallState, IPZSK_DESKTOP_API_VERSION, type ApprovedPlugin, type PluginInstallState } from './ipzsk-market-approved.ts'
import type { DesktopProjectHooks, IpzskPluginInstaller } from './ipzsk-plugin-installer.ts'

export interface IpzskMarketOptions {
  readonly manager: Pick<IpzskPluginInstaller, 'listPlugins' | 'installApproved'>
  readonly hooks: DesktopProjectHooks
  readonly catalog: () => Promise<unknown>
  readonly packaged: boolean
  readonly beforeInstall: () => Promise<void>
  readonly afterInstall?: () => Promise<void>
  readonly onInstallError: (error: unknown) => Promise<void>
}

export class IpzskMarketService {
  private readonly controller = new AbortController()
  private busy = false

  constructor(private readonly options: IpzskMarketOptions, private readonly request = fetch) {}

  async catalog(): Promise<{ plugins: (ApprovedPlugin & { installState: PluginInstallState })[]; installed: ReturnType<IpzskPluginInstaller['listPlugins']>; canInstall: boolean }> {
    const plugins = approvedCatalog(await this.options.catalog())
    const installed = this.options.packaged ? this.options.manager.listPlugins() : []
    return { plugins: plugins.map(plugin => ({ ...plugin,
      installState: pluginInstallState(installed.find(item => item.name === plugin.package_name)?.version, plugin.version) })),
    installed, canInstall: this.options.packaged }
  }

  async install(pluginId: unknown, releaseId: unknown): Promise<void> {
    if (typeof pluginId !== 'string' || typeof releaseId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(pluginId) || !/^[0-9a-f-]{36}$/iu.test(releaseId)) {
      throw new Error('插件安装请求无效。')
    }
    if (!this.options.packaged) throw new Error('安装插件需要使用已打包的 IPZSK 桌面客户端。')
    if (this.busy) throw new Error('另一项市场操作正在执行，请稍候。')
    this.controller.signal.throwIfAborted()
    this.busy = true
    try {
      const plugins = approvedCatalog(await this.options.catalog())
      const plugin = plugins.find(item => item.id === pluginId && item.release_id === releaseId)
      if (!plugin) throw new Error('该版本已变更或下架，请刷新市场。')
      assertPluginUpgrade(this.options.manager.listPlugins().find(item => item.name === plugin.package_name)?.version, plugin.version)
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(180_000)])
      const bytes = await downloadApproved(plugin, IPZSK_DESKTOP_API_VERSION, signal, this.request)
      const current = approvedCatalog(await this.options.catalog()).find(item => item.id === pluginId && item.release_id === releaseId)
      if (!current || current.sha256 !== plugin.sha256 || current.size_bytes !== plugin.size_bytes
        || current.artifact_url !== plugin.artifact_url || current.package_name !== plugin.package_name || current.version !== plugin.version) {
        throw new Error('该版本已变更或下架，请刷新市场。')
      }
      signal.throwIfAborted()
      assertPluginUpgrade(this.options.manager.listPlugins().find(item => item.name === plugin.package_name)?.version, plugin.version)
      await this.options.beforeInstall()
      try {
        await this.options.manager.installApproved(plugin, bytes, this.options.hooks)
        await this.options.afterInstall?.()
      } catch (error) {
        await this.options.onInstallError(error)
        throw new Error('安装未完成，客户端已显示恢复状态；请按恢复页面处理。')
      }
    } finally {
      this.busy = false
    }
  }

  dispose(): void { this.controller.abort() }
}
