export interface IpzskPluginConfig {
  plugin_id: string
  credential: string
  package: string
  id: string
  config: Record<string, unknown>
  credential_paths: string[][]
}

export function parseIpzskPluginConfigs(value: unknown): IpzskPluginConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new Error('后台插件配置异常。')
  for (const entry of value) {
    if (!entry || typeof entry.plugin_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(entry.plugin_id)
      || typeof entry.credential !== 'string' || !/^ipz_[A-Za-z0-9_-]{43}$/u.test(entry.credential)
      || typeof entry.package !== 'string' || !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(entry.package)
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
