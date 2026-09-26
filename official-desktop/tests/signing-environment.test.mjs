import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSignedConfig, createPreviewConfig, signingBuildEnvironment } from '../scripts/signed-config.mjs'

test('build and plugin children receive no signing or notarization credentials', () => {
  const env = {
    PATH: '/usr/bin', DSH_DESKTOP_MACOS_TEAM_ID: 'TESTTEAM00',
    APPLE_API_KEY: '/private/notary.p8', APPLE_API_KEY_BASE64: 'fixture',
    APPLE_API_KEY_ID: 'fixture', APPLE_API_ISSUER: 'fixture',
    CSC_LINK: '/private/cert.p12', CSC_KEY_PASSWORD: 'fixture',
    MAC_CERT_P12_BASE64: 'fixture', MACOS_SIGN_IDENTITY: 'fixture',
  }
  assert.deepEqual(signingBuildEnvironment(env), { PATH: '/usr/bin', DSH_DESKTOP_MACOS_TEAM_ID: 'TESTTEAM00' })
  assert.equal(env.CSC_KEY_PASSWORD, 'fixture', 'filter must not alter packaging environment')
})

test('packaging keeps the official native ASAR and signing hooks while retaining product resources', async () => {
  const appRoot = fileURLToPath(new URL('../.build/upstream/apps/desktop', import.meta.url))
  const base = { appId: 'com.ipzsk.desktop.next', productName: 'IPZSK Desktop Next',
    files: ['lib/*.cjs'], asarUnpack: ['**/*.node'], extraResources: [{ from: '/fixture/plugins', to: 'plugins' }],
    mac: { icon: '/fixture/icon.png', category: 'public.app-category.productivity', identity: null, notarize: false }, publish: null }
  const config = await createSignedConfig(base, appRoot, {
    DSH_DESKTOP_APP_ID: base.appId, DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'arm64',
    DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Fixture (TESTTEAM00)', DSH_DESKTOP_MACOS_TEAM_ID: 'TESTTEAM00',
    APPLE_KEYCHAIN_PROFILE: 'synthetic-profile',
  })
  assert.equal(config.electronFuses.runAsNode, true)
  assert.equal(config.mac.forceCodeSigning, true)
  assert.equal(config.mac.notarize, true)
  assert.ok(config.mac.signIgnore.some(pattern => pattern.includes('asar')))
  for (const hook of ['beforePack', 'afterPack', 'afterSign', 'artifactBuildCompleted']) assert.equal(typeof config[hook], 'function')
  assert.deepEqual(config.extraResources, base.extraResources)
  assert.equal(config.publish, null)
  const preview = await createPreviewConfig(base, appRoot)
  assert.equal(preview.mac.notarize, false)
  assert.equal(typeof preview.beforePack, 'function')
})
