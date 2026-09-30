/** Validated, private Electron-to-Node bootstrap. This module performs no I/O. */
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, type ProfileLayer } from '@deepseek-ai/dsh-app-boot'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'

export interface IpzskHostModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
}

export interface IpzskHostBootstrap {
  readonly version: 1
  readonly token: string
  readonly default_model: string
  readonly models: IpzskHostModel[]
  readonly image_models: { id: string; name: string; sizes: string[]; default_size: string }[]
  readonly plugin_configs: {
    plugin_id: string
    credential: string
    package: string
    id: string
    config: Record<string, unknown>
    credential_paths: string[][]
  }[]
}

const MODEL_ID = /^[a-zA-Z0-9._-]{1,128}$/u
const TOKEN = /^ipz_[A-Za-z0-9_-]{43}$/u
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
function invalid(): never { throw new Error('IPZSK 模型启动数据无效，请重新登录。') }
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0

function validateJson(value: unknown, depth = 0): void {
  if (depth > 12) invalid()
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) { value.forEach((entry) => { validateJson(entry, depth + 1) }); return }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) invalid()
      validateJson(entry, depth + 1)
    }
    return
  }
  invalid()
}

/** Check every field at the IPC boundary and return a detached, allowlisted payload. */
export function parseIpzskHostBootstrap(value: unknown): IpzskHostBootstrap {
  if (!isRecord(value) || value.version !== 1 || typeof value.token !== 'string' || !TOKEN.test(value.token)
    || typeof value.default_model !== 'string' || !Array.isArray(value.models)
    || value.models.length < 1 || value.models.length > 256) invalid()
  const models = value.models.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !MODEL_ID.test(entry.id)
      || !text(entry.name) || !integer(entry.contextWindow) || !integer(entry.maxTokens)) invalid()
    return { id: entry.id, name: entry.name, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens }
  })
  if (!models.some(model => model.id === value.default_model) || new Set(models.map(model => model.id)).size !== models.length) invalid()
  const images = value.image_models ?? []
  if (!Array.isArray(images) || images.length > 100) invalid()
  const image_models = images.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !MODEL_ID.test(entry.id) || !text(entry.name)
      || !Array.isArray(entry.sizes) || entry.sizes.length < 1 || entry.sizes.length > 100
      || entry.sizes.some(size => !text(size, 32)) || typeof entry.default_size !== 'string'
      || !entry.sizes.includes(entry.default_size)) invalid()
    return { id: entry.id, name: entry.name, sizes: [...(entry.sizes as string[])], default_size: entry.default_size }
  })
  const plugins = value.plugin_configs ?? []
  if (!Array.isArray(plugins) || plugins.length > 20) invalid()
  const plugin_configs = plugins.map((entry) => {
    if (!isRecord(entry) || typeof entry.plugin_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(entry.plugin_id)
      || typeof entry.credential !== 'string' || !TOKEN.test(entry.credential)
      || typeof entry.package !== 'string' || !/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(entry.package)
      || typeof entry.id !== 'string' || !/^[a-z0-9-]+$/u.test(entry.id)
      || !isRecord(entry.config) || !Array.isArray(entry.credential_paths) || entry.credential_paths.length > 100) invalid()
    validateJson(entry.config)
    if (JSON.stringify(entry.config).length > 256_000) invalid()
    const paths = entry.credential_paths.map((path) => {
      if (!Array.isArray(path) || path.length < 1 || path.length > 5
        || path.some(key => typeof key !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(key) || FORBIDDEN_KEYS.has(key))) invalid()
      return [...(path as string[])]
    })
    return { plugin_id: entry.plugin_id, credential: entry.credential, package: entry.package, id: entry.id,
      config: structuredClone(entry.config), credential_paths: paths }
  })
  return { version: 1, token: value.token, default_model: value.default_model, models, image_models, plugin_configs }
}

/** Resolve the account token without adding it to child environments or files. */
export function withIpzskEnvironment(environment: LaunchEnvironmentSnapshot, bootstrap: IpzskHostBootstrap): LaunchEnvironmentSnapshot {
  const isCredential = (name: string): boolean => (process.platform === 'win32' ? name.toUpperCase() : name) === 'IPZSK_DESKTOP_API_KEY'
  const entry = () => ({ value: bootstrap.token, source: 'process' as const })
  return Object.freeze({
    get: (name: string) => isCredential(name) ? entry() : environment.get(name),
    getFrom: (name: string, sources: Parameters<LaunchEnvironmentSnapshot['getFrom']>[1]) =>
      isCredential(name) ? sources.includes('process') ? entry() : undefined : environment.getFrom(name, sources),
  })
}

function provider(bootstrap: IpzskHostBootstrap) {
  return {
    displayName: 'IPZSK', api: 'openai-completions', baseURL: 'https://api.ipzsk.com/v1',
    apiKeyEnv: 'IPZSK_DESKTOP_API_KEY',
    models: bootstrap.models.map(({ id, name, contextWindow, maxTokens }) => ({ id, name, contextWindow, maxTokens, input: ['text'] })),
  }
}

/** Configure the login-owned API before plugins start; retain a valid saved IPZSK selection. */
export function ipzskModelPatches(bootstrap: IpzskHostBootstrap, composition: readonly PatchOptions[] = []): PatchOptions[] {
  const rows = composeEntries([[...composition]])
  const previous: unknown = rows.find(row => row.id === 'llm-pi-ai')?.config
  const config = isRecord(previous) ? previous : {}
  const providers = isRecord(config.providers) ? config.providers : {}
  const selection: unknown = rows.find(row => row.id === 'agent-default-model')?.config
  const selected = isRecord(selection) && selection.provider === 'ipzsk'
    && bootstrap.models.some(model => model.id === selection.model)
    ? selection : { provider: 'ipzsk', model: bootstrap.default_model }
  return [
    { id: 'llm-pi-ai', config: { ...config, providers: { ...providers, ipzsk: provider(bootstrap) } } },
    { id: 'agent-default-model', config: selected },
  ]
}

/**
 * Supply backend settings only to active rows inserted by the installed package's
 * own profile layer. The name assertion prevents an id collision from receiving
 * another plugin's credential. No package is inserted or enabled by this hook.
 */
export function ipzskPluginPatches(
  bootstrap: IpzskHostBootstrap,
  installedLayers: readonly Pick<ProfileLayer, 'packageName' | 'patches'>[],
  composition: readonly PatchOptions[],
): PatchOptions[] {
  type Row = { id?: string; name?: string; group?: boolean | null; disabled?: boolean | null; config?: unknown }
  const activeRows = new Map<string, Row>()
  const collectActive = (rows: readonly Row[], parentDisabled = false): void => {
    for (const row of rows) {
      const disabled = parentDisabled || row.disabled === true
      if (!disabled && typeof row.id === 'string') activeRows.set(row.id, row)
      if (row.group && Array.isArray(row.config)) collectActive(row.config as Row[], disabled)
    }
  }
  collectActive(composeEntries([[...composition]]))
  return bootstrap.plugin_configs.flatMap((entry) => {
    const active = activeRows.get(entry.id)
    if (!active || typeof active.name !== 'string') return []
    const ownsRow = (rows: readonly Row[]): boolean => rows.some(row =>
      row.id === entry.id && row.name === active.name
      || !!row.group && Array.isArray(row.config) && ownsRow(row.config as Row[]))
    const owned = installedLayers.some(layer => layer.packageName === entry.package
      && layer.patches.some(patch => patch.insert !== undefined && ownsRow(patch.insert)))
    if (!owned) return []
    const config = structuredClone({ ...(isRecord(active.config) ? active.config : {}), ...entry.config })
    for (const path of entry.credential_paths) {
      let parent = config
      for (const key of path.slice(0, -1)) {
        if (!isRecord(parent[key])) parent[key] = {}
        parent = parent[key] as Record<string, unknown>
      }
      const leaf = path.at(-1)
      if (leaf === undefined) invalid()
      parent[leaf] = entry.credential
    }
    return [{ id: entry.id, name: active.name, config }]
  })
}

/** Refresh the backend-owned provider after boot, before accepting any client requests. */
export async function applyIpzskModelSettings(ctx: Context, bootstrap: IpzskHostBootstrap): Promise<void> {
  const settings = ctx.get('settings')
  if (settings === undefined) throw new Error('IPZSK 模型设置服务未启动。')
  // A path mutation replaces the complete IPZSK provider while preserving other providers and preferences.
  await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'ipzsk'], value: provider(bootstrap) }])
  const previous = settings.describe().find(row => row.ns === 'agent-default-model')?.value
  if (isRecord(previous) && previous.provider === 'ipzsk' && bootstrap.models.some(model => model.id === previous.model)) return
  await settings.replace('agent-default-model', { provider: 'ipzsk', model: bootstrap.default_model })
}

/** Inject plugin credentials only into resolved Config, leaving editable profile rows credential-free. */
export function installIpzskPluginConfig(ctx: Context, patches: readonly PatchOptions[]): void {
  ctx.on('internal/config', function (_config, next) {
    const config = next() as unknown
    const patch = patches.find(row => row.id === this.entry?.options.id && row.name === this.entry?.options.name)
    if (patch === undefined) return config
    return { ...(isRecord(config) ? config : {}), ...structuredClone(patch.config as Record<string, unknown>) }
  }, { global: true })
}
