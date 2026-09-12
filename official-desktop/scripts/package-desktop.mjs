/** Package the pinned desktop; publishing and automatic updates remain disabled. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { prepare, source, root, pin } from './prepare.mjs'
import { buildPlugins } from './build-plugins.mjs'
import { createSignedConfig, signingBuildEnvironment } from './signed-config.mjs'

const packagingEnvironment = { ...process.env }
// Imported plugin builders and source preparation inherit only non-secret variables.
for (const name of Object.keys(process.env)) {
  if (!(name in signingBuildEnvironment(process.env))) delete process.env[name]
}
const signed = process.argv.includes('--signed')
if (signed && process.argv.includes('--reuse-runtime')) throw new Error('Signed builds must prepare and sign a fresh runtime')

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This preview command currently targets macOS Apple Silicon')
prepare()
const appRoot = join(source, 'apps/desktop')
const target = join(appRoot, '.desktop-build/targets/mac-arm64')
const artifacts = join(root, 'artifacts', ...(signed ? ['signed'] : []))
mkdirSync(artifacts, { recursive: true })
const env = {
  ...packagingEnvironment,
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'arm64',
  DSH_DESKTOP_APP_ID: pin.appId,
  DSH_CLIENT_COMMIT_HASH: pin.commit, DSH_CLIENT_TITLE: pin.productName,
  pnpm_config_verify_deps_before_run: 'warn',
  CSC_IDENTITY_AUTO_DISCOVERY: signed ? 'true' : 'false',
}

function run(args, cwd = source, needsNotary = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('corepack', ['pnpm', ...args], { cwd, env: needsNotary ? env : signingBuildEnvironment(env), stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Preview command failed (${code ?? signal}): ${args.join(' ')}`)))
  })
}

if (!process.argv.includes('--reuse-build')) await run(['run', 'build:official'])
const reuseRuntime = process.argv.includes('--reuse-runtime')
if (reuseRuntime) {
  const runtimeHost = join(target, 'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js')
  const builtHost = join(source, 'apps/desktop-host/lib/index.js')
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
  if (digest(runtimeHost) !== digest(builtHost)) throw new Error('The prepared Host differs from this build; prepare the runtime again')
  const runtime = JSON.parse(readFileSync(join(target, 'dsh/desktop-runtime.json'), 'utf8'))
  if (runtime.release.version !== pin.productVersion) throw new Error('Prepared runtime version differs from this build')
}
if (!reuseRuntime) {
rmSync(join(target, 'packed'), { recursive: true, force: true })
await run(['run', 'release:pack', '--family', 'dsh', '--out', join(target, 'packed/dsh')])
await run(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', join(target, 'packed/dsh')])
await run(['run', 'release:pack', '--family', 'vendor', '--out', join(target, 'packed/vendor')])
await run(['--dir', 'native/system', 'run', 'build:ts'])
mkdirSync(join(target, 'packed/landlock'), { recursive: true })
await run(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', join(target, 'packed/landlock')])
await run(['run', 'prepare:runtime'], appRoot)
await run(['run', 'prepare:packages'], appRoot)

if (signed) {
  await run(['run', 'prepare:dsh'], appRoot)
} else {
// Reuse the official materialization and integrity checks in a separately named
// local-preview command. The original release/signing entry point stays intact.
const original = readFileSync(join(appRoot, 'scripts/prepare-dsh.ts'), 'utf8')
const signBlock = "    if (process.platform === 'darwin') {\n      await signMacOSRuntime(DSH_OUTPUT_ROOT, resolveDesktopAppId(process.env), resolveMacOSSigningEnvironment(process.env))\n    }"
if (original.split(signBlock).length !== 2) throw new Error('Upstream signing step changed; review the preview preparation command')
const storeDeclaration = "const STORE_ROOT = join(BUILD_ROOT, 'store')"
if (original.split(storeDeclaration).length !== 2) throw new Error('Upstream package cache changed; review the preview preparation command')
writeFileSync(join(appRoot, 'scripts/prepare-ipzsk-preview.ts'), original
  .replace(signBlock, '    // Local preview only: production prepare-dsh.ts retains mandatory signing.')
  .replace("import {\n  resolveDesktopAppId,\n  resolveMacOSSigningEnvironment,\n} from './desktop-release-environment.mjs'\n", '')
  .replace("import {\n  signMacOSRuntime,\n} from './macos-runtime.ts'\n", '')
  .replace(storeDeclaration, "const STORE_ROOT = join(APP_ROOT, '.desktop-build', 'preview-pnpm-store')"))
await run(['exec', 'tsx', 'scripts/prepare-ipzsk-preview.ts'], appRoot)
}
}
if (process.argv.includes('--prepare-runtime-only')) process.exit(0)

await buildPlugins()
const bundled = join(root, '.build/bundled-plugins')
mkdirSync(bundled, { recursive: true })
const pluginSources = [
  { directory: 'doc-to-excel', name: 'dsh-doc-to-excel', file: 'dsh-doc-to-excel.tgz' },
  { directory: 'imagegen', name: '@dickpy/dsh-imagegen', file: 'dsh-imagegen.tgz' },
]
const plugins = []
for (const plugin of pluginSources) {
  const directory = join(root, 'plugins', plugin.directory)
  if (!existsSync(join(directory, 'package.json'))) continue
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== plugin.name || manifest.dsh?.desktop?.transport !== 'connection') throw new Error(`Preview plugin is not ready: ${plugin.name}`)
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['pack', '--ignore-scripts', '--pack-destination', bundled], { cwd: directory, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Plugin pack failed: ${plugin.name}`)))
  })
  const archive = join(bundled, `${plugin.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`)
  const bytes = readFileSync(archive)
  copyFileSync(archive, join(bundled, plugin.file))
  plugins.push({ packageName: plugin.name, version: manifest.version, file: plugin.file,
    sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length })
}
writeFileSync(join(bundled, 'manifest.json'), JSON.stringify({ schemaVersion: 1, plugins }, null, 2) + '\n')

let config = {
  appId: pin.appId, productName: pin.productName,
  artifactName: 'IPZSK.Desktop.Next-${version}-${arch}.${ext}',
  directories: { output: artifacts },
  asar: true,
  files: ['lib/*.js', 'lib/*.cjs', 'renderer/**/*', 'package.json', 'ipzsk-build.json'],
  extraResources: [
    { from: join(target, 'runtime'), to: 'runtime' },
    { from: join(target, 'dsh'), to: 'dsh' },
    { from: join(target, 'dsh/node_modules'), to: 'dsh/node_modules' },
    { from: bundled, to: 'plugins', filter: ['manifest.json', 'dsh-doc-to-excel.tgz', 'dsh-imagegen.tgz'] },
  ],
  mac: { category: 'public.app-category.productivity', icon: join(root, 'assets/app-icon.png'), identity: null, notarize: false, target: ['dmg'], signIgnore: ['/Contents/Resources/dsh(?:/|$)'] },
  dmg: { sign: false, writeUpdateInfo: false },
  npmRebuild: false,
  publish: null,
}
if (signed) config = await createSignedConfig(config, appRoot, env)
const electronDist = join(dirname(createRequire(join(appRoot, 'package.json')).resolve('electron/package.json')), 'dist')
if (existsSync(join(electronDist, 'Electron.app'))) config.electronDist = electronDist
// Functions in the signed hooks cannot be serialized to JSON.
const configPath = signed ? 'electron-builder.ipzsk-signed.mjs' : 'electron-builder.preview.json'
if (signed) {
  const base = { ...config, afterPack: undefined, afterSign: undefined, artifactBuildCompleted: undefined }
  writeFileSync(join(appRoot, configPath), `import { createSignedConfig } from ${JSON.stringify(new URL('./signed-config.mjs', import.meta.url).href)};\nexport default await createSignedConfig(${JSON.stringify(base)}, ${JSON.stringify(appRoot)}, process.env);\n`)
} else writeFileSync(join(appRoot, configPath), JSON.stringify(config, null, 2) + '\n')
await run(['exec', 'electron-builder', '--config', configPath, '--mac', '--arm64', '--publish', 'never'], appRoot, signed)
await run(['exec', 'node', '--input-type=module', '-e',
  "import { verifyDesktopRuntime } from './apps/desktop/lib/types/runtime-tree.js'; await verifyDesktopRuntime(process.argv[1], process.argv[2], { platform: 'darwin', arch: 'arm64' }); console.log('Packaged desktop runtime integrity verified')",
  join(artifacts, 'mac-arm64', `${pin.productName}.app`, 'Contents/Resources/dsh'), pin.productVersion])
await run(['exec', 'node', join(root, 'tests/packaged-plugin-startup.mjs'),
  join(artifacts, 'mac-arm64', `${pin.productName}.app`, 'Contents/Resources')])
if (signed) {
  const { verifyMacOSNotarizedApplication } = await import(new URL('../.build/upstream/apps/desktop/scripts/verify-macos-signature.mjs', import.meta.url))
  const { resolveMacOSSigningEnvironment } = await import(new URL('../.build/upstream/apps/desktop/scripts/desktop-release-environment.mjs', import.meta.url))
  verifyMacOSNotarizedApplication(join(artifacts, 'mac-arm64', `${pin.productName}.app`), resolveMacOSSigningEnvironment(env))
  const dmg = `IPZSK.Desktop.Next-${pin.productVersion}-arm64.dmg`
  writeFileSync(join(artifacts, 'SHA256SUMS.txt'), `${createHash('sha256').update(readFileSync(join(artifacts, dmg))).digest('hex')}  ${dmg}\n`)
  writeFileSync(join(artifacts, 'SIGNED.txt'), `${pin.productName} ${pin.productVersion}\nDeveloper ID signed, Apple notarized and stapled; Gatekeeper and packaged plugin startup verified.\nUpstream: ${pin.commit}\nWebsite publishing and automatic updates remain disabled.\n`)
} else writeFileSync(join(artifacts, 'PREVIEW.txt'), `${pin.productName} ${pin.productVersion}\nLocal unsigned preview. Automatic publishing and updating are disabled.\nUpstream: ${pin.commit}\n`)
