/** Keep the official signing, ASAR layout and runtime verification hooks. */
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export function signingBuildEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    !/^(APPLE_|CSC_|MAC_CERT_|MACOS_SIGN_IDENTITY$)/u.test(name)))
}

export async function createSignedConfig(base, appRoot, env) {
  const { createElectronBuilderConfig } = await import(pathToFileURL(join(appRoot, 'scripts/electron-builder-config.mjs')).href)
  const official = createElectronBuilderConfig({ ...env, IPZSK_DESKTOP_LOCAL_DISTRIBUTION: '1' })
  return {
    ...official, ...base,
    mac: { ...official.mac, icon: base.mac.icon, category: base.mac.category, target: ['dmg'] },
    dmg: { ...official.dmg, writeUpdateInfo: false },
    beforePack: official.beforePack, afterPack: official.afterPack,
    afterSign: official.afterSign, artifactBuildCompleted: official.artifactBuildCompleted,
    publish: null,
  }
}

export async function createPreviewConfig(base, appRoot) {
  const { officePackageDirectories } = await import(pathToFileURL(join(appRoot, '../../scripts/libreoffice-packages.mjs')).href)
  return { ...base, beforePack: async context => {
    const dsh = join(appRoot, '.desktop-build/targets/mac-arm64/dsh')
    const office = await officePackageDirectories(dsh, { platform: 'darwin', arch: 'arm64' })
    context.packager.config.asarUnpack = [...base.asarUnpack, ...office.map(directory => `**/${relative(dsh, directory).split('\\').join('/')}/**/*`)]
  } }
}
