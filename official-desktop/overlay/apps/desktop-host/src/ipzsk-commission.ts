import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-llm'

/** Live registry loads, isolated by agent and turn; no history text or timer grants attribution. */
export function installIpzskCommissions(ctx: Context): void {
  const turns = new WeakMap<object, { readonly turn: number; readonly loaded: Map<string, { readonly name: string; readonly content_sha256: string }> }>()
  ctx.on('agent/inbox/claimed', ({ agent, turn }) => {
    if (turns.get(agent)?.turn !== turn) turns.set(agent, { turn, loaded: new Map() })
  }, { global: true })
  ctx.on('agent/turn-stopping', ({ agent }) => { turns.delete(agent) }, { global: true })
  ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent) }, { global: true })
  ctx.on('skills/loaded', (skill, scope) => {
    if (!scope) return
    const state = turns.get(scope)
    if (!state) return
    const digest = createHash('sha256').update(skill.content, 'utf8').digest('hex')
    state.loaded.set(skill.name, { name: skill.name, content_sha256: digest })
  }, { global: true })
  ctx.on('llm/request-headers', async (options, next) => {
    const headers = await next()
    if (options.provider !== 'ipzsk' || options.purpose || !options.sessionId) return headers
    const agent = ctx.get('agents')?.get(options.sessionId)
    const state = agent ? turns.get(agent) : undefined
    if (!state || state.loaded.size === 0) return headers
    return { ...headers, 'X-IPZSK-Skill-Calls': JSON.stringify([...state.loaded.values()]) }
  })
}
