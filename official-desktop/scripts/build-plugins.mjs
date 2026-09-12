/** Build preview plugins using only the prepared official workspace and its lockfile-installed tools.
 * Run after build:official: node official-desktop/scripts/build-plugins.mjs
 * No package installation or access to other plugin checkouts is required.
 */
import { spawn } from 'node:child_process'
import { existsSync, globSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, source } from './prepare.mjs'

const readManifest = directory => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))

export async function buildPlugins() {
  if (!existsSync(join(source, 'node_modules/typescript/package.json'))
    || !existsSync(join(source, 'packages/client/connection/lib/index.js'))) {
    throw new Error('Build the prepared official workspace first (install its locked dependencies, then run build:official)')
  }
  const officialRoot = realpathSync(source)
  function officialDirectory(directory) {
    const actual = realpathSync(directory)
    const suffix = relative(officialRoot, actual)
    if (suffix.startsWith('..') || isAbsolute(suffix)) throw new Error(`Dependency is outside the prepared official workspace: ${directory}`)
    return actual
  }

  const workspaceManifest = readManifest(source)
  const workspaces = globSync(workspaceManifest.workspaces.map(pattern => `${pattern}/package.json`), { cwd: source }).sort()
    .map(file => officialDirectory(dirname(join(source, file))))
  const manifests = new Map([source, ...workspaces].map(directory => [directory, readManifest(directory)]))
  const packages = new Map(workspaces.map(directory => [manifests.get(directory).name, directory]))
  const imagegen = join(root, 'plugins/imagegen')
  const manifest = readManifest(imagegen)
  const names = new Set([
    ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.dependencies ?? {}), ...manifest.dsh.client.inject, ...manifest.dsh.client.external,
  ])
  const resolved = new Map()
  for (const name of [...names].sort()) {
    let directory = packages.get(name)
    if (!directory) {
      // Resolve only a declared dependency of an official workspace package.
      // Never let Node fall back to a parent directory or a user-global store.
      for (const [owner, info] of manifests) {
        if (!Object.hasOwn({ ...info.dependencies, ...info.devDependencies, ...info.optionalDependencies }, name)) continue
        const candidate = join(owner, 'node_modules', name)
        if (existsSync(candidate)) { directory = officialDirectory(candidate); break }
      }
    }
    if (!directory) throw new Error(`Official workspace dependency is missing: ${name}; install the upstream lockfile before building plugins`)
    if (readManifest(directory).name !== name) throw new Error(`Unexpected package identity for ${name}`)
    resolved.set(name, directory)
  }

  // This generated development directory is disposable. Recreating it also
  // removes obsolete links from earlier local builds; symlink targets survive.
  const nodeModules = join(imagegen, 'node_modules')
  rmSync(nodeModules, { recursive: true, force: true })
  mkdirSync(nodeModules, { recursive: true })
  for (const [name, directory] of resolved) {
    const destination = join(nodeModules, name)
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(directory, destination, process.platform === 'win32' ? 'junction' : 'dir')
  }
  console.log(`Linked ${resolved.size} imagegen development packages from the official workspace`)

  async function run(args, cwd) {
    await new Promise((done, fail) => {
      const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' })
      child.once('error', fail)
      child.once('exit', (code, signal) => code === 0 ? done() : fail(new Error(`Plugin build failed (${code ?? signal}): ${args.join(' ')}`)))
    })
  }
  function bin(name, command) {
    const directory = resolved.get(name)
    const entry = readManifest(directory).bin
    return join(directory, typeof entry === 'string' ? entry : entry[command])
  }
  await run(['scripts/build.mjs'], join(root, 'plugins/doc-to-excel'))
  await run([bin('typescript', 'tsc'), '--noEmit'], imagegen)
  await run([bin('tsdown', 'tsdown')], imagegen)
  console.log('Built doc-to-excel and imagegen preview plugins from the official workspace')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPlugins()
