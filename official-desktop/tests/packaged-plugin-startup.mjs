/** Exercise first installation and startup using only a packaged Resources tree. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const self = fileURLToPath(import.meta.url)
const project = resolve(dirname(self), '..')
const resources = resolve(process.argv[2])
const executable = join(resources, '../MacOS/IPZSK Desktop Next')
if (process.argv[3] !== '--isolated') {
  const scratch = await mkdtemp(join(tmpdir(), 'ipzsk-packaged-startup-'))
  try {
    const code = await new Promise((done, fail) => {
      const child = spawn(executable, ['--expose-internals', self, resources, '--isolated', scratch], {
        cwd: scratch, env: { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '', DSH_HOME: join(scratch, 'home'), LANG: 'en_US.UTF-8' },
        stdio: 'inherit', timeout: 120_000,
      })
      child.once('error', fail)
      child.once('exit', (code, signal) => signal ? fail(Error(`Packaged startup ended with ${signal}`)) : done(code))
    })
    assert.equal(code, 0, 'Packaged plugin startup failed')
  } finally { await rm(scratch, { recursive: true, force: true }) }
} else {
  const built = relative => import(pathToFileURL(join(project, '.build/upstream/apps/desktop/lib/types', relative)).href)
  const [{ DesktopProjectManager }, { resolveDesktopPaths }, { prepareBundledPreviewProfile }, { DesktopHostProcess }, { IpzskPluginInstaller }] = await Promise.all([
    built('project-manager.js'), built('paths.js'), built('ipzsk-bundled-plugin.js'), built('host-process.js'), built('ipzsk-plugin-installer.js'),
  ])
  const scratch = process.argv[4]
  const runtime = { node: executable, nodeBin: join(resources, 'runtime/bin'), pnpm: join(resources, 'runtime/pnpm/bin/pnpm.mjs'), dsh: join(resources, 'app.asar/dsh') }
  const paths = resolveDesktopPaths(join(scratch, 'home'))
  const manager = new IpzskPluginInstaller(new DesktopProjectManager(paths, runtime), runtime)
  await prepareBundledPreviewProfile(manager, resources)
  assert.deepEqual(manager.listPlugins().map(plugin => [plugin.name, plugin.enabled]), [
    ['@dickpy/dsh-imagegen', true], ['dsh-doc-to-excel', true],
  ])
  console.log('PASS both bundled plugins installed against the actual packaged dependency graph')
  const bootstrap = {
    version: 1, token: 'ipz_' + 's'.repeat(43), default_model: 'packaged-smoke',
    models: [{ id: 'packaged-smoke', name: 'Local startup fixture', contextWindow: 4096, maxTokens: 256 }],
    image_models: [], plugin_configs: [],
  }
  const host = new DesktopHostProcess(runtime.node, runtime.dsh, manager.paths.profile, undefined,
    { PATH: process.env.PATH ?? '', DSH_HOME: join(scratch, 'home'), LANG: 'en_US.UTF-8' }, undefined, join(resources, 'runtime/primary-runtime'), runtime, undefined, bootstrap)
  try {
    const ready = await host.start()
    const login = await fetch(ready.url, { redirect: 'manual' })
    assert.equal(login.status, 303)
    const origin = new URL(ready.url).origin
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const home = await fetch(origin, { headers: { cookie } })
    assert.equal(home.status, 200)
    const html = await home.text()
    assert.match(html, /__DSH_BOOT__/)
    assert.match(html, /dsh-doc-to-excel/)
    assert.match(html, /dsh-imagegen/)
    const image = await fetch(origin + '/api/dsh-imagegen/settings/describe', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, origin }, body: '{}',
    })
    assert.equal(image.status, 200)
    console.log('PASS packaged Electron Node-mode Host starts with both plugins and serves the frontend and image settings')
  } finally { await host.stop() }
}
