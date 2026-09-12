import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { ApprovedPlugin } from '../src/ipzsk-market-approved.ts'

/** A real npm-compatible tarball, used by verification and bundled-pnpm tests. */
export function marketFixture(fields: Record<string, unknown> = {}): { plugin: ApprovedPlugin; bytes: Buffer } {
  const manifest = { name: 'fixture-reviewed-plugin', version: '0.3.0-beta.1',
    dsh: { bundle: { patch: './cordis.patch.yml' }, desktop: { transport: 'connection', minVersion: '0.1.5-rc.2' } }, ...fields }
  const blocks: Buffer[] = []
  for (const [name, content] of Object.entries({ 'package/package.json': JSON.stringify(manifest), 'package/cordis.patch.yml': '[]\n' })) {
    const body = Buffer.from(content)
    const header = Buffer.alloc(512)
    header.write(name)
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write('00000000000\0', 136)
    header.fill(32, 148, 156)
    header[156] = 48
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((sum, value) => sum + value, 0)
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  const bytes = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
  const plugin: ApprovedPlugin = { id: '11111111-1111-4111-8111-111111111111', release_id: '22222222-2222-4222-8222-222222222222',
    name: 'Reviewed fixture', package_name: String(manifest.name), version: String(manifest.version), notes: '', repository: 'Fixture/plugin',
    artifact_url: 'https://github.com/Fixture/plugin/releases/download/v0.3.0-beta.1/plugin.tgz',
    sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length }
  return { plugin, bytes }
}
