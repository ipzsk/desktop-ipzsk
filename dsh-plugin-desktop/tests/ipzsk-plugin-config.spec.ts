import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { ipzskPluginPatches, parseIpzskPluginConfigs } from '../src/ipzsk-plugin-config.ts'

it('uses backend configuration for an independently installed plugin and injects secrets only into a detached copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ipzsk-plugin-'))
  try {
    const secret = 'ipz_' + 'a'.repeat(43)
    const configs = parseIpzskPluginConfigs([{ plugin_id:'7d8b7d87-b85f-49f1-bde7-a0b1a2f33401', credential:secret, package:'future-plugin', id:'future', config:{ channels:[] }, credential_paths:[['channelSecrets','ipzsk']] }])
    const base = pathToFileURL(join(root, 'package.json')).href
    expect(ipzskPluginPatches(configs, base)).toEqual([])
    const pkg = join(root, 'node_modules/future-plugin')
    await mkdir(pkg, { recursive:true })
    await writeFile(join(pkg, 'package.json'), '{"name":"future-plugin"}')
    expect(ipzskPluginPatches(configs, base)).toEqual([{ id:'future', config:{ channels:[], channelSecrets:{ ipzsk:secret } } }])
    expect(JSON.stringify(configs[0]?.config)).not.toContain(secret)
    configs[0]!.credential = 'ipz_' + 'b'.repeat(43)
    expect(ipzskPluginPatches(configs, base)[0]?.config.channelSecrets).toEqual({ ipzsk:'ipz_' + 'b'.repeat(43) })
  } finally { await rm(root, { recursive:true, force:true }) }
})
it('rejects malformed credential paths and package names', () => {
  for (const path of [['__proto__','key'],[],['constructor']]) {
    expect(() => parseIpzskPluginConfigs([{ package:'plugin',id:'plugin',config:{},credential_paths:[path] }])).toThrow()
  }
  expect(() => parseIpzskPluginConfigs([{package:'../../plugin',id:'plugin',config:{},credential_paths:[]}])).toThrow()
})
