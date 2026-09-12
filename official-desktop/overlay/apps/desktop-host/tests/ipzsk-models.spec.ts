import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyIpzskModelSettings, ipzskModelPatches, parseIpzskHostBootstrap, withIpzskEnvironment } from '../src/ipzsk-bootstrap.ts'

const homes: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

const catalog = parseIpzskHostBootstrap({ version: 1, token: 'ipz_' + 'x'.repeat(43), default_model: 'backend-model', models: [
  { id: 'backend-model', name: 'Backend supplied model', contextWindow: 128000, maxTokens: 8192 },
  { id: 'another-model', name: 'Another model', contextWindow: 256000, maxTokens: 16384 },
] })

describe('official pi-ai model connection', () => {
  it.each([false, true])('streams an authenticated backend model with tools=%s, keeping credentials out of settings and process.env', async withTools => {
    const home = await mkdtemp(join(tmpdir(), 'ipzsk-official-model-test-'))
    homes.push(home)
    const path = join(home, 'settings.json')
    await writeFile(path, JSON.stringify({ 'unrelated-plugin': { enabled: true }, 'agent-default-model': { provider: 'previous', model: 'removed' } }))
    const request = vi.fn<typeof fetch>(async () => new Response([
      'data: ' + JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', model: 'backend-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] }),
      'data: ' + JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', model: 'backend-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }),
      'data: [DONE]', '',
    ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', request)
    const environmentBefore = process.env.IPZSK_DESKTOP_API_KEY
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, withIpzskEnvironment(createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]), catalog))
    try {
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(FileSettingsProvider, { path, watch: false })
      await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credential-fixture.yaml'), watch: false })
      await ctx.plugin(DefaultModel, { provider: 'ipzsk', model: catalog.default_model })
      const config = ipzskModelPatches(catalog)[0]!.config as LlmPiAi.Config
      await ctx.plugin(LlmPiAi, config)
      await applyIpzskModelSettings(ctx, catalog)
      expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'ipzsk', model: 'backend-model' })
      expect((await ctx.llm.listModels('ipzsk')).map(model => model.id)).toEqual(['backend-model', 'another-model'])
      const chunks = []
      for await (const chunk of ctx.llm.stream({ provider: 'ipzsk', model: 'backend-model',
        ...(withTools ? { tools: [{ name: 'test_tool', description: 'Test tool', parameters: { type: 'object', properties: {} } }] } : {}),
        messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'fixture' } })],
        signal: AbortSignal.timeout(5000),
      })) chunks.push(chunk)
      expect(JSON.stringify(chunks)).toContain('hello')
      expect(request).toHaveBeenCalledOnce()
      const [url, init] = request.mock.calls[0]!
      expect(String(url)).toBe('https://api.ipzsk.com/v1/chat/completions')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + catalog.token)
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ model: 'backend-model', stream: true })
      expect(body).not.toHaveProperty('reasoning_effort')
      if (withTools) expect(body.tools[0].function.name).toBe('test_tool')
      else expect(body).not.toHaveProperty('tools')
      await ctx.settings.replace('agent-default-model', { provider: 'ipzsk', model: 'another-model' })
      await applyIpzskModelSettings(ctx, catalog)
      expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'ipzsk', model: 'another-model' })
      const saved = await readFile(path, 'utf8')
      expect(saved).not.toContain(catalog.token)
      expect(JSON.parse(saved)['unrelated-plugin']).toEqual({ enabled: true })
      expect(process.env.IPZSK_DESKTOP_API_KEY).toBe(environmentBefore)
    } finally { await ctx.fiber.dispose() }
  })
})
