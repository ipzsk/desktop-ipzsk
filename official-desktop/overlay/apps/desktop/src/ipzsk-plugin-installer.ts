/** Install reviewed IPZSK archives through the upstream shared profile package operations. */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readProfilePlugins } from '@deepseek-ai/dsh-app-boot'
import { runProfilePnpm } from '@deepseek-ai/dsh-plugin-manager/operations'
import type { DesktopProjectManager } from './project-manager.ts'
import type { BundledPreviewPlugin } from './ipzsk-bundled-plugin.ts'
import { approvedCatalog, assertPluginUpgrade, IPZSK_DESKTOP_API_VERSION, verifyArchive,
  type ApprovedPlugin, type PluginArchiveIdentity } from './ipzsk-market-approved.ts'

/** Host must stop before packages change and restart only after successful installation. */
export interface DesktopProjectHooks {
  beforeChange(): Promise<void>
  afterChange(): Promise<void>
}

/** Adapter for the authenticated market and first-run plugin seed. */
export class IpzskPluginInstaller {
  readonly paths: { readonly root: string; readonly profile: string }
  constructor(
    private readonly manager: DesktopProjectManager,
    private readonly runtime: { readonly dsh: string; readonly node: string; readonly pnpm: string; readonly nodeBin: string },
  ) {
    this.paths = { root: dirname(dirname(manager.paths.profile)), profile: manager.paths.profile }
  }

  applyRelease(): Promise<void> { return this.manager.applyRelease() }

  listPlugins(): { name: string; version: string; enabled: boolean }[] {
    if (!existsSync(join(this.paths.profile, 'package.json'))) return []
    return readProfilePlugins({ binName: 'ipzsk', profileDir: this.paths.profile, installAnchor: this.anchor })
      .dependencies.filter(item => item.bundle).map(({ name, version, enabled }) => ({ name, version, enabled }))
  }

  private get anchor(): string { return join(this.runtime.dsh, 'node_modules/@deepseek-ai/dsh/package.json') }

  async installApproved(plugin: ApprovedPlugin, bytes: Buffer, hooks: DesktopProjectHooks): Promise<void> {
    approvedCatalog({ market_id: 'dsh-ipzsk-market', plugins: [plugin] })
    await this.install(plugin, bytes, hooks, false)
  }

  installBundledPreview(
    plugin: BundledPreviewPlugin, bytes: Buffer, hooks: DesktopProjectHooks, replaceVersion?: string,
  ): Promise<boolean> {
    return this.install({ package_name: plugin.packageName, version: plugin.version,
      sha256: plugin.sha256, size_bytes: plugin.sizeBytes }, bytes, hooks, true, replaceVersion)
  }

  private async install(
    plugin: PluginArchiveIdentity, bytes: Buffer, hooks: DesktopProjectHooks, seed: boolean, replaceVersion?: string,
  ): Promise<boolean> {
    verifyArchive(bytes, plugin, IPZSK_DESKTOP_API_VERSION)
    const installed = await withFileLock(join(this.paths.profile, 'package.json'), async () => {
      const current = this.listPlugins().find(item => item.name === plugin.package_name)
      const manifest = JSON.parse(readFileSync(join(this.paths.profile, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      if (seed && Object.hasOwn(manifest.dependencies ?? {}, plugin.package_name)
        && (replaceVersion === undefined || current?.version !== replaceVersion)) return false
      assertPluginUpgrade(current?.version, plugin.version)
      const directory = join(this.paths.profile, '.ipzsk-packages')
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      if (lstatSync(directory).isSymbolicLink()) throw new Error('插件归档目录无效。')
      const archive = join(directory, `${plugin.sha256}.tgz`)
      if (existsSync(archive)) {
        const stat = lstatSync(archive)
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('插件归档文件无效。')
        verifyArchive(readFileSync(archive), plugin, IPZSK_DESKTOP_API_VERSION)
      } else writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' })
      await hooks.beforeChange()
      const result = await runProfilePnpm({ profile: 'desktop', dir: this.paths.profile,
        installAnchor: this.anchor, cwd: this.paths.profile, home: this.paths.root },
      ['add', `file:.ipzsk-packages/${plugin.sha256}.tgz`, '--save-exact', '--ignore-scripts'], {
        command: this.runtime.node, args: ['--expose-internals', this.runtime.pnpm], execution: 'service',
        env: { ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: this.runtime.node,
          PATH: `${this.runtime.nodeBin}${delimiter}${process.env.PATH ?? ''}` },
        outputBytes: 16_384, idleTimeoutMs: 120_000, signal: AbortSignal.timeout(300_000),
      })
      if (result.exitCode !== 0 || result.timedOut) throw new Error(`插件安装失败：${result.output}`)
      if (this.listPlugins().find(item => item.name === plugin.package_name)?.version !== plugin.version) {
        throw new Error('插件安装版本校验失败。')
      }
      return true
    }, { waitMs: 0 })
    if (installed) await hooks.afterChange()
    return installed
  }
}
