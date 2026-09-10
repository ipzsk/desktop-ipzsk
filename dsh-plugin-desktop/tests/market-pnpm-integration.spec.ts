import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  apply as applyDesktopPnpm,
  inject as desktopPnpmInject,
  name as desktopPnpmName,
  type DesktopPnpmBootstrap,
} from '../src/pnpm.js'

const PACKAGE_NAME = 'dsh-plugin-market-integration'
const PACKAGE_VERSION = '1.2.3'
const INTEGRITY = `sha512-${Buffer.alloc(64).toString('base64')}`

function approvedRelease() {
  const manifest = Buffer.from(JSON.stringify({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  const header = Buffer.alloc(512)
  header.write('package/package.json')
  header.write(manifest.length.toString(8).padStart(11, '0'), 124)
  header[156] = 48
  const bytes = gzipSync(Buffer.concat([
    header, manifest, Buffer.alloc(512 - manifest.length), Buffer.alloc(1024),
  ]))
  const plugin = {
    id: '11111111-1111-4111-8111-111111111111',
    release_id: '22222222-2222-4222-8222-222222222222',
    name: 'Integration fixture',
    package_name: PACKAGE_NAME,
    repository: 'Fixture/plugin',
    version: PACKAGE_VERSION,
    artifact_url: 'https://github.com/Fixture/plugin/releases/download/v1.2.3/plugin.tgz',
    size_bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    notes: '',
  }
  return { bytes, plugin }
}

interface CommunityMarketModule {
  readonly name: string
  readonly inject: string[]
  readonly apply: (ctx: Context) => void
}

function bootstrap(root: string, profileDir: string): DesktopPnpmBootstrap {
  return {
    activeProfileName: 'web',
    activeProfileDir: profileDir,
    homeDir: join(root, 'home'),
    appExecutable: join(root, 'DSH Desktop'),
    pnpmBinPath: join(root, 'runtime', 'pnpm.mjs'),
    electronVersion: '43.4.0',
    nodeBinDir: join(root, 'runtime', 'node-bin'),
    nodeShimPath: join(root, 'runtime', 'node-bin', 'node'),
    clearEnvironmentPath: join(root, 'runtime', 'clear-env.mjs'),
    dshBootstrapPath: join(root, 'runtime', 'desktop-cli.js'),
  }
}

async function writeInstalledProfile(profileDir: string): Promise<void> {
  const pluginDir = join(profileDir, 'node_modules', PACKAGE_NAME)
  await mkdir(pluginDir, { recursive: true })
  await writeFile(join(pluginDir, 'cordis.patch.yml'), '[]\n')
  await writeFile(join(pluginDir, 'package.json'), JSON.stringify({
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'market-integration-profile',
    dependencies: { [PACKAGE_NAME]: PACKAGE_VERSION },
    dsh: { profile: { bundles: [] } },
  }))
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), stringifyYaml({
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: {
          [PACKAGE_NAME]: { specifier: PACKAGE_VERSION, version: PACKAGE_VERSION },
        },
      },
    },
    packages: {
      [`${PACKAGE_NAME}@${PACKAGE_VERSION}`]: { resolution: { integrity: INTEGRITY } },
    },
    snapshots: { [`${PACKAGE_NAME}@${PACKAGE_VERSION}`]: {} },
  }))
}

async function removeInstalledProfilePlugin(profileDir: string): Promise<void> {
  await rm(join(profileDir, 'node_modules', PACKAGE_NAME), { recursive: true, force: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'market-integration-profile',
    dependencies: {},
    dsh: { profile: { bundles: [] } },
  }))
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), stringifyYaml({
    lockfileVersion: '9.0',
    importers: { '.': {} },
    packages: {},
    snapshots: {},
  }))
}

async function createWebServer() {
  const request = fetch
  type Handler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  const handlers = new Map<string, Handler>()
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    const handler = handlers.get(path)
    if (handler === undefined) {
      response.statusCode = 404
      response.end()
      return
    }
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.writableEnded) {
        response.statusCode = 500
        response.end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture web server did not bind TCP')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    service: {
      port: address.port,
      register(route: { path: string; handler: Handler }) {
        handlers.set(route.path, route.handler)
        return () => { handlers.delete(route.path) }
      },
    },
    async post(path: string, body: unknown) {
      const response = await request(`${origin}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() as Record<string, unknown> }
    },
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error === undefined) resolve(); else reject(error) })
    }),
  }
}

describe('desktop pnpm and community market integration', () => {
  it('installs a reviewed IPZSK release through the managed desktop pnpm boundary', async () => {
    const marketModuleUrl = new URL('../../dsh-community-market/src/index.js', import.meta.url).href
    const market = await import(marketModuleUrl) as CommunityMarketModule
    const root = await mkdtemp(join(tmpdir(), 'dsh-market-desktop-pnpm-'))
    const profileDir = join(root, 'profiles', 'web')
    const settingsPath = join(root, 'settings.yaml')
    const ctx = new Context()
    const webServer = await createWebServer()
    try {
      await mkdir(profileDir, { recursive: true })
      await removeInstalledProfilePlugin(profileDir)
      await writeFile(settingsPath, stringifyYaml({
        'dsh-community-market': { sources: [] },
      }))
      const { bytes, plugin } = approvedRelease()
      const download = vi.fn<typeof fetch>(async (url, init) => {
        expect(url).toBe(plugin.artifact_url)
        expect(init?.headers).toBeUndefined()
        return new Response(bytes)
      })
      vi.stubGlobal('fetch', download)
      const checkpoint = vi.fn()
      const requestRestart = vi.fn(async () => {})

      const selectedBootstrap = bootstrap(root, profileDir)
      const spawn = vi.fn<(spec: SubprocessSpawnSpec) => SubprocessHandle>((_spec) => ({
        pid: 43_120,
        stdin: undefined,
        stdout: Readable.from([]),
        stderr: Readable.from([]),
        collected: {},
        done: (async () => {
          await writeInstalledProfile(profileDir)
          return { exitCode: 0, signal: null }
        })(),
        terminate: vi.fn(),
        waitForExit: vi.fn(async () => true),
      }))
      ctx.provide('webServer', webServer.service as never)
      ctx.provide('desktopProfiles', { current: { name: 'web', dir: profileDir } })
      ctx.provide('desktopActions', { requestRestart })
      ctx.provide('ipzskMarket', {
        catalog: async () => ({ market_id: 'dsh-ipzsk-market', plugins: [plugin] }),
        checkpoint,
      })
      ctx.provide('desktopPnpmBootstrap', selectedBootstrap)
      ctx.provide('subprocess', { spawn } as unknown as SubprocessRuntime)
      await ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false })
      await ctx.plugin({ name: desktopPnpmName, inject: desktopPnpmInject, apply: applyDesktopPnpm })
      await ctx.plugin({ name: market.name, inject: market.inject, apply: market.apply })

      const executed = await webServer.post('/api/ipzsk-market/install', {
        pluginId: plugin.id,
        releaseId: plugin.release_id,
      })
      expect(executed).toMatchObject({
        status: 200,
        body: {
          action: 'install',
          packageName: PACKAGE_NAME,
          version: PACKAGE_VERSION,
          restartToken: expect.any(String),
        },
      })
      expect(spawn).toHaveBeenCalledOnce()
      expect(checkpoint).toHaveBeenCalledOnce()
      expect(download).toHaveBeenCalledOnce()
      expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(spawn.mock.invocationCallOrder[0]!)
      const archive = join(profileDir, '.ipzsk-packages', plugin.sha256 + '.tgz')
      expect(await readFile(archive)).toEqual(bytes)
      expect(spawn.mock.calls[0]?.[0]).toMatchObject({
        argv: [
          selectedBootstrap.appExecutable,
          '--import',
          pathToFileURL(selectedBootstrap.clearEnvironmentPath).href,
          selectedBootstrap.pnpmBinPath,
          '--config.minimumReleaseAge=0',
          'add',
          '--save-exact',
          '--ignore-scripts',
          archive,
        ],
        cwd: profileDir,
        env: { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: selectedBootstrap.homeDir },
      })

      const persisted = parseYaml(await readFile(settingsPath, 'utf8')) as {
        'dsh-community-market': { sources: unknown[]; installReceipts?: unknown[] }
      }
      expect(persisted['dsh-community-market']).toEqual({ sources: [] })
      const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      expect(manifest.dependencies[PACKAGE_NAME]).toBe(PACKAGE_VERSION)
      expect(manifest.dsh.profile.bundles).toContain(PACKAGE_NAME)
      expect(requestRestart).not.toHaveBeenCalled()
      expect(await webServer.post('/api/ipzsk-market/restart', {
        restartToken: executed.body.restartToken,
      })).toMatchObject({ status: 200, body: { ok: true } })
      expect(requestRestart).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
      await ctx.fiber.dispose()
      await webServer.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})
