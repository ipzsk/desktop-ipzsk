import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installBundledPreviewPlugins, parseBundledPreviewManifest, prepareBundledPreviewProfile,
  IPZSK_PREVIEW_SEED_STATE, type BundledPreviewManifest, type BundledPreviewPlugin } from '../src/ipzsk-bundled-plugin.ts'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { IpzskPluginInstaller, type DesktopProjectHooks } from '../src/ipzsk-plugin-installer.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { runtimeFixture } from './runtime-fixture.ts'
import { marketFixture } from './ipzsk-market-fixture.ts'

const roots: string[] = []
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ipzsk-bundled-plugin-'))
  roots.push(root)
  return root
}
function bundled(root: string, fields: Record<string, unknown> = {}, includeImage = false, imageVersion = '1.8.0-beta.2') {
  const doc = marketFixture({ name: 'dsh-doc-to-excel', ...fields })
  const image = marketFixture({ name: '@dickpy/dsh-imagegen', version: imageVersion })
  const plugin: BundledPreviewPlugin = { packageName: 'dsh-doc-to-excel', version: doc.plugin.version,
    file: 'dsh-doc-to-excel.tgz', sha256: doc.plugin.sha256, sizeBytes: doc.bytes.length }
  const imagePlugin: BundledPreviewPlugin = { packageName: '@dickpy/dsh-imagegen', version: image.plugin.version,
    file: 'dsh-imagegen.tgz', sha256: image.plugin.sha256, sizeBytes: image.bytes.length }
  const manifest: BundledPreviewManifest = { schemaVersion: 1, plugins: includeImage ? [plugin, imagePlugin] : [plugin] }
  const resources = join(root, 'Resources')
  mkdirSync(join(resources, 'plugins'), { recursive: true })
  writeFileSync(join(resources, 'plugins/manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(resources, 'plugins/dsh-doc-to-excel.tgz'), doc.bytes)
  if (includeImage) writeFileSync(join(resources, 'plugins/dsh-imagegen.tgz'), image.bytes)
  return { resources, manifest, plugin, bytes: doc.bytes }
}
function hooks(): DesktopProjectHooks {
  return { beforeChange: vi.fn(async () => {}), afterChange: vi.fn(async () => {}) }
}
function seedFixture() {
  const root = temporaryRoot()
  const resources = bundled(root, {}, true).resources
  const paths = { ...resolveDesktopPaths(join(root, '.dsh')), root: join(root, '.dsh') }
  const installed = new Map<string, { name: string; version: string; enabled: boolean }>()
  const manager = {
    paths,
    applyRelease: vi.fn(async () => { mkdirSync(paths.profile, { recursive: true }); writeFileSync(join(paths.profile, 'package.json'), '{}') }),
    listPlugins: () => [...installed.values()],
    installBundledPreview: vi.fn(async (plugin: BundledPreviewPlugin) => {
      installed.set(plugin.packageName, { name: plugin.packageName, version: plugin.version, enabled: true }); return true
    }),
  }
  const status = () => JSON.parse(readFileSync(join(paths.root, IPZSK_PREVIEW_SEED_STATE), 'utf8')).status
  return { root, paths, resources, installed, manager, status }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('accepts one or two fixed package/file pairs and rejects duplicates or arbitrary targets', () => {
  const { manifest, plugin } = bundled(temporaryRoot(), {}, true)
  expect(parseBundledPreviewManifest(manifest)).toEqual(manifest)
  expect(parseBundledPreviewManifest({ schemaVersion: 1, plugins: [plugin] }).plugins).toHaveLength(1)
  for (const change of [{ packageName: 'other-plugin' }, { file: '../other.tgz' }, { file: 'dsh-imagegen.tgz' },
    { version: 'latest' }, { sha256: 'a' }, { sizeBytes: 50_000_001 }]) {
    expect(() => parseBundledPreviewManifest({ schemaVersion: 1, plugins: [{ ...plugin, ...change }] })).toThrow('清单')
  }
  for (const plugins of [[], [plugin, plugin], [plugin, plugin, plugin]]) {
    expect(() => parseBundledPreviewManifest({ schemaVersion: 1, plugins })).toThrow('清单')
  }
  expect(() => parseBundledPreviewManifest({ ...manifest, schemaVersion: 2 })).toThrow('清单')
})

it('installs both bundled plugins with real pnpm as external dependencies and preserves existing versions', async () => {
  const root = temporaryRoot()
  const dsh = join(root, 'dsh')
  runtimeFixture(dsh)
  const manager = new IpzskPluginInstaller(new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { dsh }), {
    node: process.execPath, nodeBin: dirname(process.execPath), pnpm: join(import.meta.dirname, '../node_modules/pnpm/bin/pnpm.mjs'), dsh,
  })
  await manager.applyRelease()
  const { resources, plugin, bytes } = bundled(root, {}, true)
  const lifecycle = hooks()
  const data = join(manager.paths.root, 'plugin-data/document-job.txt')
  mkdirSync(join(manager.paths.root, 'plugin-data'), { recursive: true })
  writeFileSync(data, 'user document job')
  expect(await installBundledPreviewPlugins(manager, resources, lifecycle)).toEqual(['dsh-doc-to-excel', '@dickpy/dsh-imagegen'])
  expect(manager.listPlugins()).toEqual([
    { name: '@dickpy/dsh-imagegen', version: '1.8.0-beta.2', enabled: true },
    { name: 'dsh-doc-to-excel', version: plugin.version, enabled: true },
  ])
  expect(lifecycle.beforeChange).toHaveBeenCalledTimes(2)
  expect(lifecycle.afterChange).toHaveBeenCalledTimes(2)
  expect(JSON.parse(readFileSync(join(manager.paths.profile, 'package.json'), 'utf8')).dependencies['dsh-doc-to-excel'])
    .toBe(`file:.ipzsk-packages/${plugin.sha256}.tgz`)
  await expect(manager.applyRelease()).resolves.toBeUndefined()
  const manifestPath = join(manager.paths.profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== 'dsh-doc-to-excel')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const untouched = hooks()
  expect(await installBundledPreviewPlugins(manager, resources, untouched)).toEqual([])
  expect(await manager.installBundledPreview(plugin, bytes, untouched)).toBe(false)
  expect(manager.listPlugins().find(item => item.name === 'dsh-doc-to-excel')).toEqual({ name: 'dsh-doc-to-excel', version: plugin.version, enabled: false })
  expect(untouched.beforeChange).not.toHaveBeenCalled()
  expect(untouched.afterChange).not.toHaveBeenCalled()
  expect(readFileSync(data, 'utf8')).toBe('user document job')
}, 30_000)

it('rejects tampered bytes, incompatible requirements and a mismatched package before any profile mutation', async () => {
  const manager = { listPlugins: () => [], installBundledPreview: vi.fn(async () => true) }
  for (const fields of [{ name: 'unrelated-plugin' },
    { dsh: { bundle: { patch: './cordis.patch.yml' }, desktop: { transport: 'connection', minVersion: '0.2.0' } } }]) {
    const { resources } = bundled(temporaryRoot(), fields)
    await expect(installBundledPreviewPlugins(manager, resources, hooks())).rejects.toThrow()
  }
  const tampered = bundled(temporaryRoot())
  writeFileSync(join(tampered.resources, 'plugins/dsh-doc-to-excel.tgz'), Buffer.alloc(tampered.bytes.length))
  await expect(installBundledPreviewPlugins(manager, tampered.resources, hooks())).rejects.toThrow('校验')
  expect(manager.installBundledPreview).not.toHaveBeenCalled()
})

it('refuses resource file redirects and relative resource roots', async () => {
  const manager = { listPlugins: () => [], installBundledPreview: vi.fn(async () => true) }
  await expect(installBundledPreviewPlugins(manager, './Resources', hooks())).rejects.toThrow('资源目录')
  const root = temporaryRoot()
  const { resources } = bundled(root)
  writeFileSync(join(root, 'outside.json'), '{}')
  rmSync(join(resources, 'plugins/manifest.json'))
  symlinkSync(join(root, 'outside.json'), join(resources, 'plugins/manifest.json'))
  await expect(installBundledPreviewPlugins(manager, resources, hooks())).rejects.toThrow('资源文件')
  expect(manager.installBundledPreview).not.toHaveBeenCalled()
})

it('persists pending before profile preparation and retries a failed first startup', async () => {
  const { manager, resources, status } = seedFixture()
  manager.applyRelease.mockRejectedValueOnce(new Error('prepare failed'))
  await expect(prepareBundledPreviewProfile(manager, resources)).rejects.toThrow('prepare failed')
  expect(status()).toBe('pending')
  expect(manager.installBundledPreview).not.toHaveBeenCalled()
  await prepareBundledPreviewProfile(manager, resources)
  expect(status()).toBe('done')
  expect(manager.installBundledPreview).toHaveBeenCalledTimes(2)
})

it('resumes a partially completed two-plugin seed without overwriting its successful package', async () => {
  const { manager, resources, status, installed } = seedFixture()
  manager.installBundledPreview.mockImplementationOnce(async plugin => {
    installed.set(plugin.packageName, { name: plugin.packageName, version: plugin.version, enabled: false }); return true
  }).mockRejectedValueOnce(new Error('second package failed'))
  await expect(prepareBundledPreviewProfile(manager, resources)).rejects.toThrow('second package failed')
  expect(status()).toBe('pending')
  await prepareBundledPreviewProfile(manager, resources)
  expect(status()).toBe('done')
  expect(manager.installBundledPreview.mock.calls.map(([plugin]) => plugin.packageName))
    .toEqual(['dsh-doc-to-excel', '@dickpy/dsh-imagegen', '@dickpy/dsh-imagegen'])
  expect(installed.get('dsh-doc-to-excel')?.enabled).toBe(false)
})

it('a completed seed never reinstalls user-uninstalled plugins or reads newer app resources', async () => {
  const { manager, resources, paths, installed, status } = seedFixture()
  await prepareBundledPreviewProfile(manager, resources)
  installed.clear()
  manager.installBundledPreview.mockClear()
  rmSync(paths.profile, { recursive: true, force: true })
  await prepareBundledPreviewProfile(manager, '/unavailable/new-app-resources')
  expect(status()).toBe('done')
  expect(manager.installBundledPreview).not.toHaveBeenCalled()
  expect(installed.size).toBe(0)
})

it('existing profiles are marked done without seeding, and malformed state is never guessed', async () => {
  const { manager, paths, status } = seedFixture()
  mkdirSync(paths.profile, { recursive: true })
  writeFileSync(join(paths.profile, 'package.json'), '{}')
  await prepareBundledPreviewProfile(manager, '/unused/resources')
  expect(status()).toBe('done')
  expect(manager.installBundledPreview).not.toHaveBeenCalled()
  writeFileSync(join(paths.root, IPZSK_PREVIEW_SEED_STATE), JSON.stringify({ schemaVersion: 1, status: ['pending'] }))
  await expect(prepareBundledPreviewProfile(manager, '/unused/resources')).rejects.toThrow('首次安装记录')
})

it('upgrades only the incompatible bundled image plugin, retaining disabled state and user data', async () => {
  const root = temporaryRoot(), dsh = join(root, 'dsh')
  runtimeFixture(dsh)
  const manager = new IpzskPluginInstaller(new DesktopProjectManager(resolveDesktopPaths(join(root, '.dsh')), { dsh }), {
    dsh, node: process.execPath, nodeBin: dirname(process.execPath), pnpm: join(import.meta.dirname, '../node_modules/pnpm/bin/pnpm.mjs'),
  })
  const { resources } = bundled(root, {}, true, '1.8.0-beta.1')
  await prepareBundledPreviewProfile(manager, resources)
  const manifestPath = join(manager.paths.profile, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name: string) => name !== '@dickpy/dsh-imagegen')
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const data = join(manager.paths.root, 'user-job.txt')
  writeFileSync(data, 'keep')
  bundled(root, {}, true)
  await prepareBundledPreviewProfile(manager, resources)
  expect(manager.listPlugins().find(plugin => plugin.name === '@dickpy/dsh-imagegen')).toEqual({
    name: '@dickpy/dsh-imagegen', version: '1.8.0-beta.2', enabled: false,
  })
  expect(readFileSync(data, 'utf8')).toBe('keep')
  await prepareBundledPreviewProfile(manager, '/unused-resources')
}, 30_000)
