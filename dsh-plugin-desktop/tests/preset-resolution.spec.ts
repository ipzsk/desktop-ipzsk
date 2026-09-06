import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { discoverPresets } from '@deepseek-ai/dsh-agent-presets'
import { expect, it } from 'vitest'
import { installProfilePackageResolver } from '../src/module-resolution.ts'
import { shippedPresetRoot } from '../src/profile.ts'

it('discovers bundled standard plugins through the active profile resolver, without trusting another profile or missing plugins', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ipzsk-preset-resolution-'))
  await mkdir(join(home, 'profile'))
  const base = pathToFileURL(join(home, 'profile', 'package.json')).href
  const roots = [{ path: shippedPresetRoot(), trust: 'system' as const }]
  const release = installProfilePackageResolver(base)
  try {
    const standard = (await discoverPresets(roots, base)).find(preset => preset.id === 'standard')
    expect(standard).toBeDefined()
    expect(standard?.broken).toBeUndefined()
    const unrelated = pathToFileURL(join(home, 'unrelated', 'package.json')).href
    expect((await discoverPresets(roots, unrelated)).find(preset => preset.id === 'standard')?.broken).toContain('cannot be resolved')
    const missing = join(home, 'presets', 'missing')
    await mkdir(missing, { recursive: true })
    await writeFile(join(missing, 'agent.cordis.yml'), '- id: missing\n  name: ipzsk-nonexistent-plugin-fixture\n')
    expect((await discoverPresets([{ path: join(home, 'presets'), trust: 'system' }], base))[0]?.broken).toContain('cannot be resolved')
  } finally { release(); await rm(home, { recursive: true, force: true }) }
})
