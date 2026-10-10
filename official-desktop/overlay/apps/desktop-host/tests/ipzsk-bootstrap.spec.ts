import { describe, expect, it } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { ipzskModelPatches, ipzskPluginPatches, parseIpzskHostBootstrap, withIpzskEnvironment } from '../src/ipzsk-bootstrap.ts'

const fixture = () => ({ version: 1, token: 'ipz_' + 'x'.repeat(43), default_model: 'backend-model', models: [
  { id: 'backend-model', name: 'Backend model', contextWindow: 128000, maxTokens: 8192 },
] })

describe('private IPZSK Host bootstrap', () => {
  it('does not retain server Skill ownership or eligibility data', () => {
    const row = { plugin_id: '00000000-0000-0000-0000-000000000000', credential: fixture().token,
      skills: [{ name: 'fixture-skill', content_sha256: 'a'.repeat(64) }] }
    const result = parseIpzskHostBootstrap({ ...fixture(), skill_configs: [row] })
    expect(result).not.toHaveProperty('skill_configs')
    expect(JSON.stringify(ipzskModelPatches(result))).not.toContain(row.credential)
  })

  it('validates and detaches the catalog while omitting unknown fields', () => {
    const value = { ...fixture(), unexpected: 'not-for-host' }
    const result = parseIpzskHostBootstrap(value)
    value.models[0]!.name = 'changed'
    expect(result.models[0]?.name).toBe('Backend model')
    expect(result).not.toHaveProperty('unexpected')
    expect(result.image_models).toEqual([])
  })

  it.each([
    { version: 2 }, { token: 'bad' }, { default_model: 'missing' }, { models: [] }, { models: [null] },
    { models: [{ id: '../unsafe', name: 'Bad', contextWindow: 1, maxTokens: 1 }] },
    { models: [{ id: 'backend-model', name: 'Bad', contextWindow: 0, maxTokens: 1 }] },
    { models: [fixture().models[0], fixture().models[0]] },
    { image_models: [{ id: 'image', name: 'Image', sizes: ['1x1'], default_size: 'missing' }] },
  ])('refuses malformed bootstrap %# without echoing credentials', (patch) => {
    expect(() => parseIpzskHostBootstrap({ ...fixture(), ...patch })).toThrow('启动数据无效')
  })

  it('rejects plugin prototype traversal and malformed credential paths', () => {
    const plugin = { plugin_id: '00000000-0000-0000-0000-000000000000', credential: fixture().token,
      package: 'dsh-plugin', id: 'plugin', config: {}, credential_paths: [['apiKey']] }
    expect(parseIpzskHostBootstrap({ ...fixture(), plugin_configs: [plugin] }).plugin_configs[0]?.package).toBe('dsh-plugin')
    expect(() => parseIpzskHostBootstrap({ ...fixture(), plugin_configs: [{ ...plugin, credential_paths: [['__proto__']] }] })).toThrow('启动数据无效')
    expect(() => parseIpzskHostBootstrap({ ...fixture(), plugin_configs: [{ ...plugin, config: { constructor: {} } }] })).toThrow('启动数据无效')
  })

  it('makes the model credential available only through the private launch environment', () => {
    const bootstrap = parseIpzskHostBootstrap(fixture())
    const before = process.env.IPZSK_DESKTOP_API_KEY
    const base = createLaunchEnvironmentSnapshot([{ source: 'process', values: { OTHER: 'kept' } }])
    const environment = withIpzskEnvironment(base, bootstrap)
    expect(environment.get('IPZSK_DESKTOP_API_KEY')).toEqual({ source: 'process', value: bootstrap.token })
    expect(environment.getFrom('IPZSK_DESKTOP_API_KEY', ['project-env', 'user-env'])).toBeUndefined()
    expect(environment.get('OTHER')?.value).toBe('kept')
    expect(process.env.IPZSK_DESKTOP_API_KEY).toBe(before)
    expect(JSON.stringify(ipzskModelPatches(bootstrap))).not.toContain(bootstrap.token)
    expect(ipzskModelPatches(bootstrap)).toMatchObject([
      { id: 'llm-pi-ai', config: { providers: { ipzsk: { baseURL: 'https://api.ipzsk.com/v1', api: 'openai-completions' } } } },
      { id: 'agent-default-model', config: { provider: 'ipzsk', model: 'backend-model' } },
    ])
  })

  it.each(['deepseek-official', 'ipzsk'])('replaces stale %s defaults and an edited IPZSK endpoint before boot', (provider) => {
    const bootstrap = parseIpzskHostBootstrap(fixture())
    const composition = [{ insert: [
      { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { custom: { baseURL: 'https://example.invalid/v1' },
        ipzsk: { baseURL: 'https://old.invalid/v1', apiKeyEnv: 'OLD_KEY' } } } },
      { id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: { provider, model: 'removed-model' } },
    ] }]
    const patches = ipzskModelPatches(bootstrap, composition)
    expect(patches).toMatchObject([
      { config: { providers: { custom: { baseURL: 'https://example.invalid/v1' },
        ipzsk: { baseURL: 'https://api.ipzsk.com/v1', apiKeyEnv: 'IPZSK_DESKTOP_API_KEY' } } } },
      { config: { provider: 'ipzsk', model: bootstrap.default_model } },
    ])
    expect(JSON.stringify(patches)).not.toContain(bootstrap.token)
    expect(JSON.stringify(composition)).toContain('https://old.invalid/v1')
  })

  it('retains an authorized IPZSK model and effort selected by the user', () => {
    const bootstrap = parseIpzskHostBootstrap(fixture())
    const selected = { provider: 'ipzsk', model: bootstrap.default_model, reasoningEffort: 'low' }
    expect(ipzskModelPatches(bootstrap, [{ insert: [{ id: 'agent-default-model', name: '@deepseek-ai/dsh-agent-default-model', config: selected }] }])[1])
      .toEqual({ id: 'agent-default-model', config: selected })
  })

  it('adds runtime plugin credentials only to the matching active installed bundle row', () => {
    const bootstrap = parseIpzskHostBootstrap({ ...fixture(), plugin_configs: [{
      plugin_id: '00000000-0000-0000-0000-000000000000', credential: fixture().token,
      package: 'dsh-imagegen', id: 'imagegen', config: { endpoint: 'https://api.ipzsk.com/v1', auth: { mode: 'bearer' } }, credential_paths: [['auth', 'apiKey']],
    }] })
    const layers = [{ packageName: 'dsh-imagegen', patches: [{ insert: [{ id: 'imagegen', name: 'file:///fixture/imagegen/lib/index.js', config: { display: 'keep' } }] }] }]
    const composition = layers.flatMap(layer => layer.patches)
    expect(ipzskPluginPatches(bootstrap, layers, composition)).toEqual([{ id: 'imagegen', name: 'file:///fixture/imagegen/lib/index.js', config: {
      display: 'keep', endpoint: 'https://api.ipzsk.com/v1', auth: { mode: 'bearer', apiKey: fixture().token },
    } }])
    expect(JSON.stringify(layers)).not.toContain(fixture().token)
    expect(bootstrap.plugin_configs[0]?.config).toEqual({ endpoint: 'https://api.ipzsk.com/v1', auth: { mode: 'bearer' } })
    expect(ipzskPluginPatches(bootstrap, [], composition)).toEqual([])
    expect(ipzskPluginPatches(bootstrap, layers, [])).toEqual([])
    expect(ipzskPluginPatches(bootstrap, layers, [...composition, { id: 'imagegen', disabled: true }])).toEqual([])
    expect(ipzskPluginPatches(bootstrap, layers, [{ insert: [{ id: 'imagegen', name: 'file:///fixture/other/lib/index.js' }] }])).toEqual([])
  })

  it('respects inherited group disablement and recognizes nested plugin rows', () => {
    const bootstrap = parseIpzskHostBootstrap({ ...fixture(), plugin_configs: [{
      plugin_id: '00000000-0000-0000-0000-000000000000', credential: fixture().token,
      package: 'dsh-imagegen', id: 'imagegen', config: {}, credential_paths: [['apiKey']],
    }] })
    const layers = [{ packageName: 'dsh-imagegen', patches: [{ insert: [{ id: 'bundle', name: 'group', group: true as const, config: [{ id: 'imagegen', name: 'dsh-imagegen' }] }] }] }]
    const composition = layers.flatMap(layer => layer.patches)
    expect(ipzskPluginPatches(bootstrap, layers, composition)).toEqual([{ id: 'imagegen', name: 'dsh-imagegen', config: { apiKey: fixture().token } }])
    expect(ipzskPluginPatches(bootstrap, layers, [...composition, { id: 'bundle', disabled: true }])).toEqual([])
  })
})
