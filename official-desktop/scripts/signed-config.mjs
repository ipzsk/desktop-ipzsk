/** Connect IPZSK resources to the official native signing and verification hooks. */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function signingBuildEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    !/^(APPLE_|CSC_|MAC_CERT_|MACOS_SIGN_IDENTITY$)/u.test(name)))
}

export async function createSignedConfig(base, appRoot, env) {
  const load = name => import(pathToFileURL(join(appRoot, 'scripts', name)).href)
  const { resolveMacOSSigningEnvironment, resolveMacOSNotarizationEnvironment } = await load('desktop-release-environment.mjs')
  const { verifyMacOSSignatureAfterSign, assertMacOSSignatureDetails } = await load('verify-macos-signature.mjs')
  const { notarizeMacOSDiskImageArtifact } = await load('notarize-macos-disk-images.mjs')
  const { verifyDesktopRuntime } = await import(pathToFileURL(join(appRoot, 'lib/types/runtime-tree.js')).href)
  const expected = resolveMacOSSigningEnvironment(env)
  resolveMacOSNotarizationEnvironment(env)
  function apple(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', env: signingBuildEnvironment(env) })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${command} verification failed: ${result.stderr}`)
    return `${result.stdout}${result.stderr}`
  }
  const runtime = context => verifyDesktopRuntime(
    join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources/dsh'),
    context.packager.appInfo.version, { platform: 'darwin', arch: 'arm64' })
  return {
    ...base,
    mac: { ...base.mac, identity: expected.signingIdentity, forceCodeSigning: true,
      hardenedRuntime: true, notarize: true, signIgnore: ['/Contents/Resources/dsh(?:/|$)', '\\.pak$'] },
    dmg: { ...base.dmg, sign: true },
    afterPack: runtime,
    afterSign: async context => {
      await runtime(context)
      verifyMacOSSignatureAfterSign(context, expected)
    },
    artifactBuildCompleted: artifact => notarizeMacOSDiskImageArtifact(artifact, env, expected, undefined, (path, identity) => {
      apple('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', path])
      assertMacOSSignatureDetails(apple('/usr/bin/codesign', ['--display', '--verbose=4', path]), identity)
      apple('/usr/bin/xcrun', ['stapler', 'validate', path])
      // A DMG is assessed as an opened disk image; "install" is for installer packages.
      apple('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', path])
    }),
    publish: null,
  }
}
