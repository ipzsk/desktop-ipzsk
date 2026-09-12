/** First-install-only preview resources; these are independent plugins, not remote market releases. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { valid } from 'semver'
import { IPZSK_DESKTOP_API_VERSION, verifyArchive } from './ipzsk-market-approved.ts'
import type { DesktopProjectHooks, DesktopProjectManager } from './project-manager.ts'

export const IPZSK_PREVIEW_FILES = {
  'dsh-doc-to-excel': 'dsh-doc-to-excel.tgz',
  '@dickpy/dsh-imagegen': 'dsh-imagegen.tgz',
} as const
export const IPZSK_PREVIEW_SEED_STATE = 'ipzsk-preview-plugins.json'
type PreviewPackageName = keyof typeof IPZSK_PREVIEW_FILES

export interface BundledPreviewPlugin {
  readonly packageName: PreviewPackageName
  readonly version: string
  readonly file: typeof IPZSK_PREVIEW_FILES[PreviewPackageName]
  readonly sha256: string
  readonly sizeBytes: number
}
export interface BundledPreviewManifest {
  readonly schemaVersion: 1
  readonly plugins: readonly BundledPreviewPlugin[]
}

type PreviewInstaller = Pick<DesktopProjectManager, 'listPlugins' | 'installBundledPreview'>
type PreviewManager = PreviewInstaller & Pick<DesktopProjectManager, 'paths' | 'applyRelease'>

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The build owns two exact package/file pairs; no renderer may supply a path. */
export function parseBundledPreviewPlugin(value: unknown): BundledPreviewPlugin {
  if (!record(value) || typeof value.packageName !== 'string' || !Object.hasOwn(IPZSK_PREVIEW_FILES, value.packageName)) {
    throw new Error('预览插件清单无效。')
  }
  const packageName = value.packageName as PreviewPackageName
  if (value.file !== IPZSK_PREVIEW_FILES[packageName]
    || typeof value.version !== 'string' || valid(value.version) !== value.version
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(value.sha256)
    || typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 50_000_000) {
    throw new Error('预览插件清单无效。')
  }
  return { packageName, version: value.version, file: IPZSK_PREVIEW_FILES[packageName], sha256: value.sha256, sizeBytes: value.sizeBytes }
}

export function parseBundledPreviewManifest(value: unknown): BundledPreviewManifest {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins) || value.plugins.length < 1 || value.plugins.length > 2) {
    throw new Error('预览插件清单无效。')
  }
  const plugins = value.plugins.map((entry: unknown) => parseBundledPreviewPlugin(entry))
  if (new Set(plugins.map(plugin => plugin.packageName)).size !== plugins.length) throw new Error('预览插件清单包含重复包名。')
  return { schemaVersion: 1, plugins }
}

async function regularFile(path: string, maximum: number): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maximum) throw new Error('预览插件资源文件无效。')
}

/** Called only by Electron startup after profile preparation, with process.resourcesPath. */
export async function installBundledPreviewPlugins(
  manager: PreviewInstaller, resourcesPath: string, hooks: DesktopProjectHooks,
): Promise<readonly string[]> {
  if (!isAbsolute(resourcesPath)) throw new Error('预览插件资源目录必须由桌面客户端提供。')
  const directory = join(resourcesPath, 'plugins')
  const directoryInfo = await lstat(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('预览插件资源目录无效。')
  const manifestPath = join(directory, 'manifest.json')
  await regularFile(manifestPath, 16_384)
  const manifest = parseBundledPreviewManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const installed = new Set(manager.listPlugins().map(plugin => plugin.name))
  const added: string[] = []
  for (const plugin of manifest.plugins) {
    // An app update or retried first-run must never replace or re-enable an installed plugin.
    if (installed.has(plugin.packageName)) continue
    const archive = join(directory, plugin.file)
    await regularFile(archive, plugin.sizeBytes)
    const bytes = await readFile(archive)
    verifyArchive(bytes, { package_name: plugin.packageName, version: plugin.version,
      sha256: plugin.sha256, size_bytes: plugin.sizeBytes }, IPZSK_DESKTOP_API_VERSION)
    // The manager checks absence again after taking the shared package lock.
    if (await manager.installBundledPreview(plugin, bytes, hooks)) added.push(plugin.packageName)
  }
  return added
}

type SeedStatus = 'pending' | 'done'
async function readSeedStatus(path: string): Promise<SeedStatus | undefined> {
  try { await regularFile(path, 1024) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!record(value) || value.schemaVersion !== 1 || (value.status !== 'pending' && value.status !== 'done')) {
    throw new Error('预览插件首次安装记录无效。')
  }
  return value.status
}
async function writeSeedStatus(path: string, status: SeedStatus): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, status }) + '\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error })
  }
}

/**
 * Preparation callback for backend.start, before any Host exists.
 * A failed first-run retains pending across retries; completed or pre-existing profiles never seed again.
 */
export async function prepareBundledPreviewProfile(manager: PreviewManager, resourcesPath: string): Promise<void> {
  const statePath = join(manager.paths.root, IPZSK_PREVIEW_SEED_STATE)
  let status = await readSeedStatus(statePath)
  if (status === undefined) {
    let fresh = false
    try { await lstat(join(manager.paths.profile, 'package.json')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      fresh = true
    }
    status = fresh ? 'pending' : 'done'
    await mkdir(manager.paths.root, { recursive: true, mode: 0o700 })
    // Persist intent before applyRelease creates the profile; an interrupted preparation can retry.
    await writeSeedStatus(statePath, status)
  }
  await manager.applyRelease()
  if (status === 'done') return
  await installBundledPreviewPlugins(manager, resourcesPath, { beforeChange: async () => {}, afterChange: async () => {} })
  await writeSeedStatus(statePath, 'done')
}
