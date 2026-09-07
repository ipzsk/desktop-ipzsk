import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { createRequire } from 'node:module'
// Load the already-installed runtime; its bundled SDK declarations contain broken relative type paths.
const LlmPiAi = createRequire(import.meta.url)('@deepseek-ai/dsh-llm-pi-ai') as {
  name: string; inject: string[]; apply(ctx: Context, config: unknown): void
}
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { parse } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureIpzskModels } from '../src/setup-wizard-settings.ts'
import { withIpzskCredential } from '../src/launch-environment.ts'

const homes: string[] = []
const catalog = { default_model: 'gpt-5.6-sol', models: [
  { id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', contextWindow: 128000, maxTokens: 8192 },
  { id: 'future-chat-model', name: 'Backend supplied model', contextWindow: 128000, maxTokens: 8192 },
] }
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})
async function settings(extension: string) {
  const home = await mkdtemp(join(tmpdir(), 'ipzsk-models-'))
  homes.push(home)
  return join(home, 'settings.' + extension)
}

describe('automatic IPZSK model connection', () => {
  it.each(['yaml', 'json'])('configures a fresh %s profile, preserves unrelated preferences, and writes no credential', async ext => {
    const path = await settings(ext)
    await writeFile(path, JSON.stringify({ 'other-plugin': { enabled: true }, 'agent-default-model': { provider: 'old', model: 'old' } }))
    await configureIpzskModels(path, catalog)
    const raw = await readFile(path, 'utf8'), config = parse(raw)
    expect(config['agent-default-model']).toEqual({ provider: 'ipzsk', model: 'gpt-5.6-sol' })
    expect(config['other-plugin']).toEqual({ enabled: true })
    expect(config['llm-pi-ai'].providers.ipzsk.baseURL).toBe('https://api.ipzsk.com/v1')
    expect(raw).not.toContain('ipz_')
    config['agent-default-model'].model = 'future-chat-model'
    await writeFile(path, JSON.stringify(config))
    await configureIpzskModels(path, catalog)
    expect(parse(await readFile(path, 'utf8'))['agent-default-model'].model).toBe('future-chat-model')
  })

  it.each(catalog.models.flatMap(model => [false, true].map(withTools => ({ model: model.id, withTools }))))('sends compatible authenticated requests for $model withTools=$withTools', async ({ model, withTools }) => {
    const path = await settings('yaml')
    await configureIpzskModels(path, catalog)
    const request = vi.fn(async () => new Response([
      'data: ' + JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', model: 'gpt-5.6-sol', choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'chat-test', object: 'chat.completion.chunk', model: 'gpt-5.6-sol', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }),
      'data: [DONE]', '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', request)
    const ctx = new Context()
    let token = 'ipz_' + 'a'.repeat(43)
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, withIpzskCredential(createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]), () => token))
    const mounts: { dispose(): Promise<unknown> }[] = []
    try {
      const llm = ctx.plugin(LlmRuntime); mounts.push(llm); await llm
      const settings = ctx.plugin(FileSettingsProvider, { path, watch: false }); mounts.push(settings); await settings
      const credentials = ctx.plugin(LocalCredentials, { dshHome: dirname(path), watch: false }); mounts.push(credentials); await credentials
      const defaults = ctx.plugin(DefaultModel, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }); mounts.push(defaults); await defaults
      expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'ipzsk', model: 'gpt-5.6-sol' })
      const adapter = ctx.plugin(LlmPiAi, {}); mounts.push(adapter); await adapter
      expect((await ctx.llm.listModels('ipzsk')).map(model => model.id)).toEqual(catalog.models.map(model => model.id))
      const chunks = []
      for await (const chunk of ctx.llm.stream({ provider: 'ipzsk', model,
        ...(withTools ? { tools: [{ name: 'test_tool', description: 'Test tool', parameters: { type: 'object', properties: {} } }] } : {}),
        messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })],
        signal: AbortSignal.timeout(5000),
      })) chunks.push(chunk)
      expect(JSON.stringify(chunks)).toContain('hello')
      const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
      expect(String(url)).toBe('https://api.ipzsk.com/v1/chat/completions')
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer ' + token)
      const payload = JSON.parse(String(init.body))
      expect(payload).toMatchObject({ model, stream: true })
      expect(payload).not.toHaveProperty('reasoning_effort')
      if (withTools) expect(payload.tools[0].function.name).toBe('test_tool')
      else expect(payload).not.toHaveProperty('tools')
      token = ''
      expect(process.env.IPZSK_DESKTOP_API_KEY).toBeUndefined()
    } finally { for (const mount of mounts.reverse()) await mount.dispose() }
  })
})
