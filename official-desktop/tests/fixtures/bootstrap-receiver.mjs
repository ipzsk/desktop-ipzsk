/** Real-fork fixture. Only allowlisted diagnostics are printed; payloads are never echoed. */
import { receiveIpzskBootstrap } from '../../.build/upstream/apps/desktop-host/src/ipzsk-bootstrap-channel.ts'
import { parseIpzskHostBootstrap } from '../../.build/upstream/apps/desktop-host/src/ipzsk-bootstrap.ts'

const initialMessages = process.listenerCount('message')
const initialDisconnects = process.listenerCount('disconnect')
try {
  const value = await receiveIpzskBootstrap()
  const bootstrap = parseIpzskHostBootstrap(value)
  const tokens = [bootstrap.token, ...bootstrap.plugin_configs.map(plugin => plugin.credential)]
  process.stdout.write(JSON.stringify({ ok: true, model: bootstrap.default_model,
    cleanArgv: tokens.every(token => !process.argv.some(value => value.includes(token))),
    cleanEnv: tokens.every(token => !Object.values(process.env).some(value => value?.includes(token))),
    messageListeners: process.listenerCount('message') - initialMessages,
    disconnectListeners: process.listenerCount('disconnect') - initialDisconnects,
  }) + '\n')
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message,
    messageListeners: process.listenerCount('message') - initialMessages,
    disconnectListeners: process.listenerCount('disconnect') - initialDisconnects,
  }) + '\n')
  process.exitCode = 1
} finally {
  if (process.connected) process.disconnect()
}
