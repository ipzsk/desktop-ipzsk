import assert from 'node:assert/strict'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const directory = dirname(fileURLToPath(import.meta.url))
const upstream = join(directory, '../.build/upstream')
const requireUpstream = createRequire(join(upstream, 'package.json'))
const { tsImport } = await import(pathToFileURL(requireUpstream.resolve('tsx/esm/api')).href)
const { DesktopHostProcess } = await tsImport(join(upstream, 'apps/desktop/src/host-process.ts'), import.meta.url)
const { DesktopBackendController } = await tsImport(join(upstream, 'apps/desktop/src/backend-controller.ts'), import.meta.url)
const receiver = join(directory, 'fixtures/bootstrap-receiver.mjs')
const hostFixture = pathToFileURL(join(directory, 'fixtures/bootstrap-host.mjs')).href

// Deliberately synthetic values: no account store, environment credential, or network access is used.
const bootstrap = { version: 1, token: `ipz_${'T'.repeat(43)}`, default_model: 'fixture-qwen',
  models: [{ id: 'fixture-qwen', name: 'Fixture Qwen', contextWindow: 32000, maxTokens: 4096 }], image_models: [],
  plugin_configs: [{ plugin_id: '11111111-1111-4111-8111-111111111111', credential: `ipz_${'P'.repeat(43)}`,
    package: 'fixture-plugin', id: 'fixture-plugin', config: {}, credential_paths: [['token']] }],
}
const tokens = [bootstrap.token, bootstrap.plugin_configs[0].credential]
const cleanEnvironment = { PATH: process.env.PATH, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) }

function noSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const token of tokens) assert.equal(text.includes(token), false, 'startup payload must not appear in diagnostics, args or environment')
}
async function bounded(promise, milliseconds = 5000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fixture operation did not settle')), milliseconds) })])
  } finally { clearTimeout(timer) }
}
async function until(check, milliseconds = 5000) {
  const end = Date.now() + milliseconds
  while (!await check()) {
    if (Date.now() >= end) throw new Error('fixture did not reach expected state')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
function receiverProcess(t, ipc = true) {
  const child = ipc ? fork(receiver, [], { execArgv: [], env: cleanEnvironment, silent: true })
    : spawn(process.execPath, [receiver], { env: cleanEnvironment, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  // Node 24 can omit ChildProcess.close after a parent-initiated disconnect;
  // actual process exit plus drained output is the lifecycle fact under test.
  const exited = once(child, 'exit')
  const closed = Promise.all([exited, once(child.stdout, 'end'), once(child.stderr, 'end')]).then(([exit]) => exit)
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await bounded(closed)
    noSecrets(stdout + stderr)
  })
  return { child, closed, output: () => ({ stdout, stderr }), result: () => JSON.parse(stdout.trim()) }
}

test('real fork requests exactly one bootstrap and removes its startup listeners', { timeout: 10000 }, async t => {
  const fixture = receiverProcess(t)
  const messages = []
  fixture.child.on('message', message => messages.push(message))
  const [ready] = await bounded(once(fixture.child, 'message'))
  assert.deepEqual(ready, { type: 'ipzsk-bootstrap-ready', version: 1 })
  fixture.child.send({ type: 'ipzsk-bootstrap', value: bootstrap })
  assert.deepEqual(await bounded(fixture.closed), [0, null])
  assert.deepEqual(messages, [{ type: 'ipzsk-bootstrap-ready', version: 1 }])
  assert.deepEqual(fixture.result(), { ok: true, model: 'fixture-qwen', cleanArgv: true, cleanEnv: true, messageListeners: 0, disconnectListeners: 0 })
  assert.equal(fixture.output().stderr, '')
})

test('startup receiver rejects absent IPC, malformed commands and invalid account data without echoing payloads', { timeout: 15000 }, async t => {
  const standalone = receiverProcess(t, false)
  assert.deepEqual(await bounded(standalone.closed), [1, null])
  assert.match(standalone.result().error, /requires its desktop parent/u)
  for (const message of [{ type: 'shutdown', value: bootstrap }, { type: 'ipzsk-bootstrap' }, { type: 'ipzsk-bootstrap', value: { ...bootstrap, version: 2 } }]) {
    const fixture = receiverProcess(t)
    await bounded(once(fixture.child, 'message'))
    fixture.child.send(message)
    assert.deepEqual(await bounded(fixture.closed), [1, null])
    assert.equal(fixture.result().ok, false)
    assert.match(fixture.result().error, /invalid startup message|启动数据无效/u)
    assert.equal(fixture.result().messageListeners, 0)
    assert.equal(fixture.result().disconnectListeners, 0)
  }
})

test('parent disconnect while awaiting bootstrap rejects promptly and lets the child exit', { timeout: 10000 }, async t => {
  const fixture = receiverProcess(t)
  await bounded(once(fixture.child, 'message'))
  fixture.child.disconnect()
  assert.deepEqual(await bounded(fixture.closed), [1, null])
  assert.match(fixture.result().error, /disconnected during startup/u)
  assert.equal(fixture.result().messageListeners, 0)
  assert.equal(fixture.output().stderr, '')
})

test('the real 15-second bootstrap timeout releases the IPC listener and exits', { timeout: 20000 }, async t => {
  const fixture = receiverProcess(t)
  await bounded(once(fixture.child, 'message'))
  const started = Date.now()
  assert.deepEqual(await bounded(fixture.closed, 18000), [1, null])
  assert.ok(Date.now() - started >= 14000, 'production timeout should not be replaced by a test stub')
  assert.match(fixture.result().error, /startup timed out/u)
  assert.equal(fixture.result().messageListeners, 0)
  assert.equal(fixture.result().disconnectListeners, 0)
})

async function hostProcess(t, mode, payload = bootstrap, failure = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'ipzsk-bootstrap-host-'))
  const runtime = join(root, 'runtime')
  const profile = join(root, 'profile')
  const packageRoot = join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host')
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await mkdir(profile)
  await writeFile(join(packageRoot, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(packageRoot, 'lib/index.js'), `import {runBootstrapHost} from ${JSON.stringify(hostFixture)}; await runBootstrapHost(${JSON.stringify(mode)});\n`)
  const host = new DesktopHostProcess(process.execPath, runtime, profile, undefined, cleanEnvironment, failure, undefined, undefined, undefined, payload)
  t.after(async () => {
    await host.stop()
    noSecrets(host.stderr)
    if (host.stderr.trim()) t.diagnostic(host.stderr.trim())
    async function inspect(directory) {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, item.name)
        if (item.isDirectory()) await inspect(file)
        else noSecrets(await readFile(file, 'utf8'))
      }
    }
    await inspect(root)
    await rm(root, { recursive: true, force: true })
  })
  const report = async () => JSON.parse(await readFile(join(profile, 'fixture-report.json'), 'utf8'))
  const started = () => until(async () => { try { return (await report()).started } catch { return false } })
  return { host, report, started }
}

test('actual DesktopHostProcess sends bootstrap once over IPC and concurrent start calls share it', { timeout: 10000 }, async t => {
  const { host, report } = await hostProcess(t, 'normal')
  const [first, second] = await bounded(Promise.all([host.start(), host.start()]))
  assert.equal(first.url, 'http://127.0.0.1:12345/?token=fixture')
  assert.deepEqual(second, first)
  assert.deepEqual(await report(), { started: true, received: 1, model: 'fixture-qwen', cleanArgv: true, cleanEnv: true })
  await bounded(host.stop())
})

test('actual parent rejects duplicate/wrong-version handshakes and malformed child IPC, then stops', { timeout: 20000 }, async t => {
  for (const mode of ['duplicate-handshake', 'wrong-handshake-version', 'unknown-event', 'exit-before-handshake']) {
    const failures = []
    const { host, report } = await hostProcess(t, mode, bootstrap, error => failures.push(error.message))
    await assert.rejects(bounded(host.start()), /startup exchange|invalid IPC|pipe ended|exited/u)
    await bounded(host.stop())
    assert.equal(failures.length, 1)
    noSecrets(failures)
    if (mode === 'duplicate-handshake') assert.equal((await report()).received, 1)
    else assert.equal((await report()).received, 0)
  }
})

test('invalid bootstrap causes real receiver failure and actual parent startup rejection', { timeout: 10000 }, async t => {
  const failures = []
  const { host } = await hostProcess(t, 'normal', { ...bootstrap, default_model: 'not-in-catalog' }, error => failures.push(error.message))
  await assert.rejects(bounded(host.start()), /启动数据无效/u)
  await bounded(host.stop())
  assert.equal(failures.length, 1)
  noSecrets(failures)
})

test('backend cancellation settles a child still waiting to exchange bootstrap', { timeout: 10000 }, async t => {
  let fixture
  const states = []
  const backend = new DesktopBackendController(onFailure => {
    return { start: async () => {
      fixture = await hostProcess(t, 'silent-until-stop', bootstrap, onFailure)
      return fixture.host.start()
    }, stop: async () => { await fixture?.host.stop() } }
  }, state => states.push(state.phase))
  const starting = backend.start(async () => {}).catch(error => error)
  await until(() => fixture !== undefined)
  await fixture.started()
  await bounded(backend.close())
  await bounded(starting)
  assert.equal(backend.host, undefined)
  assert.equal(states.includes('ready'), false)
})

test('fatal IPC after authenticated readiness triggers actual backend teardown once', { timeout: 10000 }, async t => {
  let fixture
  const states = []
  const backend = new DesktopBackendController(onFailure => {
    return { start: async () => {
      fixture = await hostProcess(t, 'fatal-after-ready', bootstrap, onFailure)
      return fixture.host.start()
    }, stop: async () => { await fixture?.host.stop() } }
  }, state => states.push(state))
  await backend.start(async () => {}).catch(() => {})
  await until(() => states.some(state => state.phase === 'error'))
  await bounded(backend.close())
  noSecrets(states)
  assert.equal(states.filter(state => state.phase === 'error').length, 1)
  assert.equal(backend.host, undefined)
})

async function builtHost(t) {
  const profile = await mkdtemp(join(tmpdir(), 'ipzsk-built-bootstrap-'))
  const child = fork(join(upstream, 'apps/desktop-host/lib/index.js'), [profile, profile], {
    execArgv: [], env: cleanEnvironment, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],
  })
  let stdout = '', stderr = ''
  const messages = []
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('message', message => messages.push(message))
  const exited = Promise.all([once(child, 'exit'), once(child.stdout, 'end'), once(child.stderr, 'end')]).then(([exit]) => exit)
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await bounded(exited)
    child.stdio[3].destroy()
    child.stdio[4].destroy()
    noSecrets(stdout + stderr)
    noSecrets(messages)
    await rm(profile, { recursive: true, force: true })
  })
  const [ready] = await bounded(once(child, 'message'))
  assert.deepEqual(ready, { type: 'ipzsk-bootstrap-ready', version: 1 })
  return { child, exited, messages, output: () => ({ stdout, stderr }) }
}

test('built Host entry handles parent disconnect without a closed-channel send error or hanging', { timeout: 10000 }, async t => {
  const fixture = await builtHost(t)
  fixture.child.disconnect()
  assert.deepEqual(await bounded(fixture.exited), [1, null])
  assert.match(fixture.output().stderr, /disconnected during startup/u)
  assert.doesNotMatch(fixture.output().stderr, /ERR_IPC_CHANNEL_CLOSED|Unhandled/u)
  assert.equal(fixture.messages.length, 1)
})

test('built Host entry reports rejected credentials and shutdown during handshake, then exits', { timeout: 10000 }, async t => {
  for (const command of [{ type: 'ipzsk-bootstrap', value: { ...bootstrap, default_model: 'invalid' } }, { type: 'shutdown' }]) {
    const fixture = await builtHost(t)
    fixture.child.send(command)
    assert.deepEqual(await bounded(fixture.exited), [1, null])
    const failure = fixture.messages.find(message => message.type === 'fatal')
    assert.ok(failure, 'built Host must report a sanitized failure before exiting')
    assert.match(failure.message, /启动数据无效|invalid startup message/u)
    assert.match(fixture.output().stderr, /启动数据无效|invalid startup message/u)
    assert.doesNotMatch(fixture.output().stderr, /ERR_IPC_CHANNEL_CLOSED|Unhandled/u)
  }
})
