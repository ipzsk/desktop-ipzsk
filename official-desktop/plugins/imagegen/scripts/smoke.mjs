/** Run the full imagegen suite without touching user configuration or data. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = await mkdtemp(join(tmpdir(), 'ipzsk-imagegen-smoke-'))
try {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./smoke-suite.mjs', import.meta.url)), root], {
    cwd: root, env: {PATH: process.env.PATH ?? '', DSH_HOME: join(root, 'dsh-home'), LANG: 'en_US.UTF-8'}, stdio: 'inherit',
  })
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000)
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
  } finally { clearTimeout(timer) }
} finally { await rm(root, {recursive: true, force: true}) }
