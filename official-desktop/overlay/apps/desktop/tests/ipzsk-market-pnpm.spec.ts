import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { IpzskPluginInstaller, type DesktopProjectHooks } from '../src/ipzsk-plugin-installer.ts'
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runtimeFixture } from './runtime-fixture.ts'
import { marketFixture } from './ipzsk-market-fixture.ts'

const roots: string[] = []
function setup(fail = false) {
  const root = mkdtempSync(join(tmpdir(), 'ipzsk-reviewed-pnpm-'))
  roots.push(root)
  const dsh = join(root, 'dsh')
  runtimeFixture(dsh)
  let pnpm = join(import.meta.dirname, '../node_modules/pnpm/bin/pnpm.mjs')
  if (fail) { pnpm = join(root, 'pnpm.mjs'); writeFileSync(pnpm, 'process.exit(3)\n') }
  const manager = new IpzskPluginInstaller(new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { dsh }), { node: process.execPath, nodeBin: dirname(process.execPath), pnpm, dsh })
  const hooks: DesktopProjectHooks = { beforeChange: vi.fn(async () => {}), afterChange: vi.fn(async () => {}) }
  return { root, manager, hooks, ...marketFixture() }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('installs a reviewed prerelease with bundled pnpm, preserves data, and restarts through the official hooks', async () => {
  const { manager, hooks, plugin, bytes } = setup()
  await manager.applyRelease()
  const data = join(manager.paths.profile, 'document-job.txt')
  writeFileSync(data, 'preserve this document job')
  await manager.installApproved(plugin, bytes, hooks)
  expect(manager.listPlugins()).toEqual([{ name: plugin.package_name, version: plugin.version, enabled: true }])
  const manifest = JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8'))
  expect(manifest.dependencies[plugin.package_name]).toBe(`file:.ipzsk-packages/${plugin.sha256}.tgz`)
  expect(readFileSync(data, 'utf8')).toBe('preserve this document job')
  expect(hooks.beforeChange).toHaveBeenCalledOnce()
  expect(hooks.afterChange).toHaveBeenCalledOnce()
  const older = marketFixture({ version: '0.2.1' })
  const unchanged: DesktopProjectHooks = { beforeChange: vi.fn(async () => {}), afterChange: vi.fn(async () => {}) }
  await expect(manager.installApproved(older.plugin, older.bytes, unchanged)).rejects.toThrow('阻止降级')
  await expect(manager.installApproved(plugin, bytes, unchanged)).rejects.toThrow('该版本已安装')
  expect(unchanged.beforeChange).not.toHaveBeenCalled()
  expect(unchanged.afterChange).not.toHaveBeenCalled()
  expect(manager.listPlugins()).toEqual([{ name: plugin.package_name, version: plugin.version, enabled: true }])
  await expect(manager.applyRelease()).resolves.toBeUndefined()
  await expect(runPluginCommand({ profile: 'desktop', dir: manager.paths.profile,
    installAnchor: join(manager.paths.root, '../dsh/node_modules/@deepseek-ai/dsh/package.json'), cwd: manager.paths.profile },
    ['update', plugin.package_name], { execution: 'service', outputBytes: 1024 })).rejects.toThrow('IPZSK')
  expect(readFileSync(data, 'utf8')).toBe('preserve this document job')
}, 30_000)

it('rejects incompatible or altered bytes before stopping the Host or invoking pnpm', async () => {
  const { manager, hooks, plugin, bytes } = setup()
  await manager.applyRelease()
  await expect(manager.installApproved({ ...plugin, sha256: '0'.repeat(64) }, bytes, hooks)).rejects.toThrow('校验')
  const old = marketFixture({ dsh: { bundle: { patch: './cordis.patch.yml' }, desktop: { transport: 'connection', minVersion: '0.2.0' } } })
  await expect(manager.installApproved(old.plugin, old.bytes, hooks)).rejects.toThrow()
  expect(hooks.beforeChange).not.toHaveBeenCalled()
  expect(existsSync(join(manager.paths.profile, '.ipzsk-packages'))).toBe(false)
  expect(manager.listPlugins()).toEqual([])
})

it('shares the official transaction lock with the normal plugin manager', async () => {
  const { manager, plugin, bytes, hooks } = setup()
  await manager.applyRelease()
  let release: (() => void) | undefined
  const beforeChange = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  const installing = manager.installApproved(plugin, bytes, { ...hooks, beforeChange })
  await vi.waitFor(() => expect(release).toBeDefined())
  try {
    await expect(withFileLock(join(manager.paths.profile, 'package.json'), async () => {}, { waitMs: 0 })).rejects.toThrow()
  } finally { release!(); await installing }
}, 30_000)

it('preserves profile data on pnpm failure and does not claim success', async () => {
  const { manager, hooks, plugin, bytes } = setup(true)
  await manager.applyRelease()
  await expect(manager.installApproved(plugin, bytes, hooks)).rejects.toThrow('插件安装失败')
  expect(hooks.beforeChange).toHaveBeenCalledOnce()
  expect(hooks.afterChange).not.toHaveBeenCalled()
  expect(manager.listPlugins()).toEqual([])
  await expect(withFileLock(join(manager.paths.profile, 'package.json'), async () => 'released', { waitMs: 0 })).resolves.toBe('released')
})
