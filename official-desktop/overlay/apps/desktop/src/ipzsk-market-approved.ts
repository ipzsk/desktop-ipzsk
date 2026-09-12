/** Reviewed release verification. Account credentials never reach artifact downloads. */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { compare, gte, valid } from 'semver'

/** Package facts shared by server-approved releases and immutable preview resources. */
export interface PluginArchiveIdentity {
  readonly package_name: string
  readonly version: string
  readonly sha256: string
  readonly size_bytes: number
}

export interface ApprovedPlugin extends PluginArchiveIdentity {
  readonly id: string
  readonly release_id: string
  readonly name: string
  readonly repository: string
  readonly artifact_url: string
  readonly notes: string
}

const ID = /^[0-9a-f-]{36}$/iu
const PACKAGE = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/u
const BLOCKED = new Set(['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-community-market', 'dsh-ipzsk-market', 'dshmarket'])
/** Upstream API capability baseline; independent of the IPZSK product release number. */
export const IPZSK_DESKTOP_API_VERSION = '0.1.5-rc.2'

export type PluginInstallState = 'install' | 'update' | 'current' | 'ahead'
/** Compare release precedence, including prereleases, in the trusted main process. */
export function pluginInstallState(installed: string | undefined, available: string): PluginInstallState {
  if (installed === undefined) return 'install'
  const order = compare(installed, available)
  return order > 0 ? 'ahead' : order === 0 ? 'current' : 'update'
}

/** Stale market windows must never reinstall or downgrade an existing package. */
export function assertPluginUpgrade(installed: string | undefined, available: string): void {
  const state = pluginInstallState(installed, available)
  if (state === 'ahead') throw new Error('已安装版本高于市场审核版本，已阻止降级。')
  if (state === 'current') throw new Error('该版本已安装，请刷新市场。')
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validate authoritative account catalog data without accepting renderer-supplied URLs. */
export function approvedCatalog(value: unknown): ApprovedPlugin[] {
  if (!record(value) || value.market_id !== 'dsh-ipzsk-market' || !Array.isArray(value.plugins) || value.plugins.length > 1000) {
    throw new Error('插件目录无效。')
  }
  return value.plugins.map((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || !ID.test(item.id)
      || typeof item.release_id !== 'string' || !ID.test(item.release_id)
      || typeof item.name !== 'string' || typeof item.notes !== 'string'
      || typeof item.package_name !== 'string' || !PACKAGE.test(item.package_name)
      || item.package_name.startsWith('@deepseek-ai/') || BLOCKED.has(item.package_name)
      || typeof item.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(item.repository)
      || typeof item.version !== 'string' || valid(item.version) !== item.version
      || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(item.sha256)
      || typeof item.size_bytes !== 'number' || !Number.isSafeInteger(item.size_bytes) || item.size_bytes <= 0 || item.size_bytes > 50_000_000
      || typeof item.artifact_url !== 'string') throw new Error('插件版本信息无效。')
    const url = new URL(item.artifact_url)
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith(`/${item.repository}/releases/download/`)) throw new Error('插件必须来自已登记的 GitHub Release。')
    return Object.freeze({ id: item.id, release_id: item.release_id, name: item.name, notes: item.notes,
      package_name: item.package_name, repository: item.repository, version: item.version,
      artifact_url: item.artifact_url, sha256: item.sha256, size_bytes: item.size_bytes })
  })
}

/** Only content-addressed archives owned by the desktop profile are valid file dependencies. */
export function isApprovedArchiveSpec(value: string): boolean {
  return /^file:\.ipzsk-packages\/[0-9a-f]{64}\.tgz$/u.test(value)
}

/** Require an explicit new-desktop transport declaration before touching the active profile. */
export function assertDesktopCompatibility(manifest: Record<string, unknown>, hostVersion: string): void {
  const dsh = record(manifest.dsh) ? manifest.dsh : undefined
  const desktop = record(dsh?.desktop) ? dsh.desktop : undefined
  if (desktop?.transport !== 'connection' || typeof desktop.minVersion !== 'string'
    || valid(desktop.minVersion) !== desktop.minVersion || !gte(hostVersion, desktop.minVersion)) {
    throw new Error('该插件版本尚未适配当前官方桌面架构，请等待开发者发布并审核兼容版本。')
  }
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[key]
    if (record(dependencies) && Object.hasOwn(dependencies, '@deepseek-ai/dsh-host-webserver')) {
      throw new Error('该插件仍依赖 HTTP webServer，无法安装到当前官方桌面客户端。')
    }
  }
}

/** Check reviewed bytes, package identity, bundle path, and desktop transport. */
export function verifyArchive(bytes: Buffer, plugin: PluginArchiveIdentity, hostVersion: string): void {
  if (bytes.length !== plugin.size_bytes || createHash('sha256').update(bytes).digest('hex') !== plugin.sha256) {
    throw new Error('安装包校验失败，请重新发布并审核该版本。')
  }
  const tar = gunzipSync(bytes, { maxOutputLength: 200_000_000 })
  let manifest: Record<string, unknown> | undefined
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString().replace(/\0.*$/su, '')
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/su, '').trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('安装包格式无效。')
    if (name === 'package/package.json') {
      if (manifest || size > 1_000_000 || ![0, 48].includes(header[156]!)) throw new Error('安装包清单无效。')
      const parsed: unknown = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString())
      if (!record(parsed)) throw new Error('安装包清单无效。')
      manifest = parsed
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  const dsh = record(manifest?.dsh) ? manifest.dsh : undefined
  const bundle = record(dsh?.bundle) ? dsh.bundle : undefined
  const patch = typeof bundle?.patch === 'string' ? bundle.patch.replace(/^\.\//u, '') : ''
  if (!manifest || manifest.name !== plugin.package_name || manifest.version !== plugin.version
    || !patch || patch.includes('\\') || patch.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('插件包名、版本或 DSH 入口不匹配。')
  }
  assertDesktopCompatibility(manifest, hostVersion)
}

/** Download only from GitHub's release infrastructure, with no account headers. */
export async function downloadApproved(plugin: ApprovedPlugin, hostVersion: string, signal: AbortSignal, request = fetch): Promise<Buffer> {
  let url = plugin.artifact_url
  for (let redirects = 0; redirects < 4; redirects++) {
    const target = new URL(url)
    if (target.protocol !== 'https:' || target.port || target.username || target.password
      || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)) {
      throw new Error('安装包跳转地址无效。')
    }
    const response = await request(url, { redirect: 'manual', signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('安装包下载失败。')
      url = new URL(location, url).href
      continue
    }
    if (!response.ok || !response.body) throw new Error('GitHub 安装包暂时无法下载。')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length
      if (size > plugin.size_bytes) throw new Error('安装包大小异常。')
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks)
    verifyArchive(bytes, plugin, hostVersion)
    return bytes
  }
  throw new Error('安装包跳转过多。')
}
