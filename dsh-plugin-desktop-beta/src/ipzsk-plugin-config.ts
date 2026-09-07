import { createRequire } from 'node:module'

export interface IpzskPluginConfig {
  package: string
  id: string
  config: Record<string, unknown>
  credential_paths: string[][]
}

/** Apply backend settings only to separately installed plugins. Never persist credentials. */
export function ipzskPluginPatches(configs: IpzskPluginConfig[], profileBase: string, credential: string) {
  const require = createRequire(profileBase)
  return configs.flatMap(entry => {
    try { require.resolve(entry.package + '/package.json') } catch { return [] }
    const config = structuredClone(entry.config)
    for (const path of entry.credential_paths) {
      let parent = config
      for (const key of path.slice(0, -1)) {
        if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {}
        parent = parent[key] as Record<string, unknown>
      }
      parent[path.at(-1)!] = credential
    }
    return [{ id: entry.id, config }]
  })
}

export function parseIpzskPluginConfigs(value: unknown): IpzskPluginConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new Error('后台插件配置异常。')
  for (const entry of value) {
    if (!entry || typeof entry.package !== 'string' || !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(entry.package)
      || typeof entry.id !== 'string' || !/^[a-z0-9-]+$/u.test(entry.id)
      || !entry.config || typeof entry.config !== 'object' || Array.isArray(entry.config)
      || !Array.isArray(entry.credential_paths) || entry.credential_paths.some((path: unknown) =>
        !Array.isArray(path) || !path.length || path.length > 5 || path.some(key => typeof key !== 'string'
          || !/^[a-zA-Z0-9_-]+$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)))) {
      throw new Error('后台插件配置异常。')
    }
  }
  return value as IpzskPluginConfig[]
}
