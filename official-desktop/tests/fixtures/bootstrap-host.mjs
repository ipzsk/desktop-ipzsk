/** An IPC Host fixture using the production startup receiver and parser. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { receiveIpzskBootstrap } from '../../.build/upstream/apps/desktop-host/src/ipzsk-bootstrap-channel.ts'
import { parseIpzskHostBootstrap } from '../../.build/upstream/apps/desktop-host/src/ipzsk-bootstrap.ts'

export async function runBootstrapHost(mode) {
  let received = 0
  let stopped = false
  const report = value => writeFileSync(join(process.argv[3], 'fixture-report.json'), JSON.stringify(value))
  const close = () => {
    if (stopped) return
    stopped = true
    if (process.connected) process.send({ type: 'shutdown-complete' }, () => process.disconnect())
  }
  report({ started: true, received })
  if (mode === 'exit-before-handshake') { process.exit(3) }
  if (mode === 'wrong-handshake-version' || mode === 'unknown-event') {
    process.on('message', () => {})
    process.send(mode === 'unknown-event' ? { type: 'unexpected' } : { type: 'ipzsk-bootstrap-ready', version: 2 })
    return
  }
  if (mode === 'silent-until-stop') {
    process.on('message', message => { if (message.type === 'shutdown') close() })
    return
  }
  process.on('message', message => {
    if (message?.type === 'ipzsk-bootstrap') { received++; report({ started: true, received }) }
  })
  try {
    const bootstrap = parseIpzskHostBootstrap(await receiveIpzskBootstrap())
    const tokens = [bootstrap.token, ...bootstrap.plugin_configs.map(plugin => plugin.credential)]
    report({ started: true, received, model: bootstrap.default_model,
      cleanArgv: tokens.every(token => !process.argv.some(value => value.includes(token))),
      cleanEnv: tokens.every(token => !Object.values(process.env).some(value => value?.includes(token))),
    })
    if (mode === 'duplicate-handshake') {
      process.send({ type: 'ipzsk-bootstrap-ready', version: 1 })
      return
    }
    process.on('message', message => { if (message.type === 'shutdown') close() })
    process.once('disconnect', close)
    process.send({ type: 'ready', url: 'http://127.0.0.1:12345/?token=fixture', injections: [] })
    if (mode === 'fatal-after-ready') setImmediate(() => process.send({ type: 'fatal', message: 'fixture host unavailable' }))
  } catch (error) {
    if (process.connected) process.send({ type: 'fatal', message: error.message })
    process.exitCode = 1
    close()
  }
}
