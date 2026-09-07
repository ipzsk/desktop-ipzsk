/** Approved GitHub release artifacts. Credentials never leave the IPZSK API. */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { valid } from 'semver'
export interface ApprovedPlugin {
  id: string; release_id: string; name: string; package_name: string; repository: string
  version: string; artifact_url: string; sha256: string; size_bytes: number; notes: string
}
export function approvedCatalog(value: unknown): ApprovedPlugin[] {
  const data = value as { market_id?: string; plugins?: ApprovedPlugin[] }
  if (data?.market_id !== 'dsh-ipzsk-market' || !Array.isArray(data.plugins) || data.plugins.length > 1000) throw new Error('插件目录无效。')
  for (const p of data.plugins) {
    if (!p || !/^[0-9a-f-]{36}$/i.test(p.id) || !/^[0-9a-f-]{36}$/i.test(p.release_id)
      || typeof p.name !== 'string' || typeof p.notes !== 'string'
      || !/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(p.package_name)
      || p.package_name.startsWith('@deepseek-ai/') || ['dsh-plugin-desktop','dsh-plugin-desktop-beta','dsh-community-market','dsh-ipzsk-market','dshmarket'].includes(p.package_name)
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repository)
      || !valid(p.version) || !/^[0-9a-f]{64}$/.test(p.sha256)
      || !Number.isSafeInteger(p.size_bytes) || p.size_bytes <= 0 || p.size_bytes > 50_000_000) throw new Error('插件版本信息无效。')
    const url = new URL(p.artifact_url)
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith('/' + p.repository + '/releases/download/')) throw new Error('插件必须来自已登记的 GitHub Release。')
  }
  return data.plugins
}
export function verifyArchive(bytes: Buffer, p: ApprovedPlugin): void {
  if (bytes.length !== p.size_bytes || createHash('sha256').update(bytes).digest('hex') !== p.sha256) throw new Error('安装包校验失败，请重新发布并审核该版本。')
  const tar = gunzipSync(bytes, { maxOutputLength: 200_000_000 })
  let manifest: { name?: string; version?: string; dsh?: { bundle?: unknown } } | undefined
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(b => b === 0)) break
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '')
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('安装包格式无效。')
    if (name === 'package/package.json') {
      if (manifest || size > 1_000_000 || ![0,48].includes(header[156]!)) throw new Error('安装包清单无效。')
      manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString())
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (manifest?.name !== p.package_name || manifest.version !== p.version || !manifest.dsh?.bundle) throw new Error('插件包名、版本或 DSH 入口不匹配。')
}
export async function downloadApproved(p: ApprovedPlugin, signal: AbortSignal, request = fetch): Promise<Buffer> {
  let url = p.artifact_url
  for (let n = 0; n < 4; n++) {
    const target = new URL(url)
    if (target.protocol !== 'https:' || target.port || target.username || target.password
      || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(target.hostname)) throw new Error('安装包跳转地址无效。')
    const response = await request(url, { redirect: 'manual', signal })
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel()
      if (!location) throw new Error('安装包下载失败。')
      url = new URL(location, url).href; continue
    }
    if (!response.ok || !response.body) throw new Error('GitHub 安装包暂时无法下载。')
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length
      if (size > p.size_bytes) throw new Error('安装包大小异常。')
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks); verifyArchive(bytes,p); return bytes
  }
  throw new Error('安装包跳转过多。')
}
