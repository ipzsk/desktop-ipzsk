import assert from 'node:assert/strict'
import test from 'node:test'
import { signingBuildEnvironment } from '../scripts/signed-config.mjs'

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
