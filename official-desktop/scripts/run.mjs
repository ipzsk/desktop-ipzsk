/** Explicit build/start commands; building never opens the graphical application. */
import { spawn } from 'node:child_process'
import { prepare, source, pin } from './prepare.mjs'

const action = process.argv[2]
const commands = {
  install: ['install', '--frozen-lockfile'],
  build: ['run', 'build:official'],
  start: ['run', 'start:desktop'],
}
if (!(action in commands)) throw new Error('Expected install, build or start')
prepare()
const child = spawn('corepack', ['pnpm', ...commands[action]], {
  cwd: source,
  env: {
    ...process.env,
    DSH_DESKTOP_OPEN_DEVTOOLS: '0',
    DSH_CLIENT_COMMIT_HASH: pin.commit,
    DSH_CLIENT_TITLE: pin.productName,
    pnpm_config_verify_deps_before_run: 'warn',
  },
  stdio: 'inherit',
})
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
