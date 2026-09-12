/** Reproduce the pinned official source and the reviewed IPZSK overlay. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const source = join(root, '.build', 'upstream')
export const pin = JSON.parse(readFileSync(join(root, 'upstream.lock.json'), 'utf8'))

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`)
}

export function prepare() {
  const archive = join(root, '.build', `upstream-${pin.commit}.tar.gz`)
  mkdirSync(dirname(archive), { recursive: true })
  if (!existsSync(archive)) run('curl', ['--fail', '--location', '--retry', '2', '--connect-timeout', '15', '--max-time', '300', `${pin.repository.replace('github.com', 'codeload.github.com')}/tar.gz/${pin.commit}`, '-o', archive])
  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (hash !== pin.archiveSha256) throw new Error('Pinned upstream archive checksum mismatch')
  const marker = join(source, '.ipzsk-upstream-commit')
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() !== pin.commit) throw new Error('Use a fresh build directory for a different upstream commit')
  mkdirSync(source, { recursive: true })
  const patchesDir = join(root, 'patches')
  const patches = existsSync(patchesDir) ? readdirSync(patchesDir).filter(name => name.endsWith('.patch')).sort() : []
  if (!existsSync(marker)) {
    run('tar', ['-xzf', archive, '--strip-components=1', '-C', source])
  } else {
    // Restore only files owned by the overlays; preserve dependencies and build outputs.
    const targets = new Set(patches.flatMap(name => [...readFileSync(join(patchesDir, name), 'utf8').matchAll(/^--- a\/(.+)$/gm)].map(match => match[1])))
    // Version stamping owns these manifests too. Restore them before applying
    // patches so a later product version cannot retain the previous build's stamp.
    for (const path of ['package.json', ...globSync(['apps/*/package.json', 'packages/*/*/package.json'], { cwd: source })]) targets.add(path)
    run('tar', ['-xzf', archive, '--strip-components=1', '-C', source,
      ...[...targets].map(target => `deepseek-harness-${pin.commit}/${target}`)])
  }
  for (const name of patches) run('patch', ['--batch', '-p1', '-i', join(patchesDir, name)], source)
  cpSync(join(root, 'overlay'), source, { recursive: true })
  // The official release identity binds shell, Host and every first-party dsh package.
  // Give the complete downstream unit one version; vendored libraries stay pinned.
  for (const path of ['package.json', ...globSync(['apps/*/package.json', 'packages/*/*/package.json'], { cwd: source })]) {
    const absolute = join(source, path)
    const text = readFileSync(absolute, 'utf8')
    const manifest = JSON.parse(text)
    if (manifest.version === pin.sourceVersion) writeFileSync(absolute, text.replace(`"version": "${pin.sourceVersion}"`, `"version": "${pin.productVersion}"`))
  }
  writeFileSync(join(source, 'apps/desktop/ipzsk-build.json'), JSON.stringify(pin, null, 2) + '\n')
  writeFileSync(marker, pin.commit + '\n')
  console.log(`Prepared ${pin.productName} ${pin.productVersion} from ${pin.commit.slice(0, 12)}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepare()
