/** Import GitHub signing credentials only for this build, then remove them. */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signingBuildEnvironment } from './signed-config.mjs'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Signing requires macOS Apple Silicon')
const required = name => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing GitHub signing secret: ${name}`)
  return value
}
const certificate = required('MAC_CERT_P12_BASE64')
const password = required('CSC_KEY_PASSWORD')
const configuredIdentity = required('MACOS_SIGN_IDENTITY')
const notaryKey = required('APPLE_API_KEY_BASE64')
const keyId = required('APPLE_API_KEY_ID')
const issuer = required('APPLE_API_ISSUER')
const cleanEnv = signingBuildEnvironment(process.env)
const scratch = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'ipzsk-signing-'))
const keychain = join(scratch, 'build.keychain-db')
const keychainPassword = randomBytes(32).toString('hex')
function security(args) {
  const result = spawnSync('/usr/bin/security', args, { encoding: 'utf8', env: cleanEnv })
  if (result.error || result.status !== 0) throw new Error(`Signing keychain operation failed: ${args[0]}`)
  return result.stdout
}
let originalKeychains = []
let keychainCreated = false
try {
  originalKeychains = [...security(['list-keychains', '-d', 'user']).matchAll(/"([^"]+)"/gu)].map(match => match[1])
  const p12 = join(scratch, 'certificate.p12')
  const p8 = join(scratch, 'notary.p8')
  writeFileSync(p12, Buffer.from(certificate, 'base64'), { mode: 0o600 })
  writeFileSync(p8, Buffer.from(notaryKey, 'base64'), { mode: 0o600 })
  security(['create-keychain', '-p', keychainPassword, keychain])
  keychainCreated = true
  security(['set-keychain-settings', '-lut', '21600', keychain])
  security(['unlock-keychain', '-p', keychainPassword, keychain])
  security(['import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'])
  rmSync(p12)
  security(['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain])
  security(['list-keychains', '-d', 'user', '-s', keychain, ...originalKeychains])
  const identities = [...security(['find-identity', '-v', '-p', 'codesigning', keychain])
    .matchAll(/([A-Fa-f0-9]{40}) "Developer ID Application: ([^"\n]+ \(([A-Z0-9]{10})\))"/gu)]
  const matches = identities.filter(match => [match[1], match[2], `Developer ID Application: ${match[2]}`,
    match[2].replace(/ \([A-Z0-9]{10}\)$/u, '')].includes(configuredIdentity))
  if (matches.length !== 1) throw new Error('Configured signing identity does not match one valid Developer ID certificate')
  const env = { ...cleanEnv, DSH_DESKTOP_MACOS_SIGNING_IDENTITY: matches[0][2],
    DSH_DESKTOP_MACOS_TEAM_ID: matches[0][3], APPLE_API_KEY: p8, APPLE_API_KEY_ID: keyId, APPLE_API_ISSUER: issuer }
  // Certificate bytes/password never reach dependency, build, plugin or packaging subprocesses.
  console.log('Developer ID credential preflight passed; building the signed desktop')
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./package-desktop.mjs', import.meta.url)), '--signed', ...process.argv.slice(2)],
      { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Signed build failed (${code ?? signal})`)))
  })
} finally {
  if (keychainCreated) {
    try { security(['list-keychains', '-d', 'user', '-s', ...originalKeychains]) }
    finally { try { security(['delete-keychain', keychain]) } catch { console.error('Temporary keychain cleanup failed') } }
  }
  rmSync(scratch, { recursive: true, force: true })
}
