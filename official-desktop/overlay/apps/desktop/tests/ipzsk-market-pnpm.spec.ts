import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopProjectManager, type DesktopProjectHooks } from '../src/project-manager.ts'
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
  const manager = new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { node: process.execPath, pnpm, dsh })
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
  await expect(manager.applyRelease()).resolves.toBe(false)
  await expect(manager.mutate({ type: 'plugin-update', name: plugin.package_name, version: '0.4.0' }, hooks)).rejects.toThrow('IPZSK')
  await manager.mutate({ type: 'plugin-toggle', name: plugin.package_name, enabled: false }, hooks)
  expect(manager.listPlugins()[0]?.enabled).toBe(false)
  await manager.mutate({ type: 'plugin-remove', name: plugin.package_name }, hooks)
  expect(manager.listPlugins()).toEqual([])
  expect(readFileSync(data, 'utf8')).toBe('preserve this document job')
}, 30_000)

it('rejects incompatible or altered bytes before stopping the Host or invoking pnpm', async () => {
  const { manager, hooks, plugin, bytes } = setup()
  await manager.applyRelease()
  await expect(manager.installApproved({ ...plugin, sha256: '0'.repeat(64) }, bytes, hooks)).rejects.toThrow('校验')
  const old = marketFixture({ peerDependencies: { '@deepseek-ai/dsh-host-webserver': '>=0.1.2-0' } })
  await expect(manager.installApproved(old.plugin, old.bytes, hooks)).rejects.toThrow('webServer')
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
  await expect(manager.mutate({ type: 'plugins-disable-all' }, hooks)).rejects.toThrow('another package transaction')
  release!()
  await installing
  expect(existsSync(manager.paths.lock)).toBe(false)
}, 30_000)

it('preserves official pending-package recovery state on pnpm failure and does not claim success', async () => {
  const { manager, hooks, plugin, bytes } = setup(true)
  await manager.applyRelease()
  await expect(manager.installApproved(plugin, bytes, hooks)).rejects.toThrow('pnpm exited')
  expect(hooks.beforeChange).toHaveBeenCalledOnce()
  expect(hooks.afterChange).not.toHaveBeenCalled()
  expect(existsSync(manager.paths.lock)).toBe(false)
  expect(existsSync(join(manager.paths.profile, 'desktop-packages-pending'))).toBe(true)
  expect(existsSync(join(manager.paths.profile, 'node_modules/@deepseek-ai/cordis'))).toBe(true)
})
