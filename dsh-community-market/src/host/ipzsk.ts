import type { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { requestAllowed, mutationAllowed, readJson } from './routes.js'
import { approvedCatalog } from '../install/approved.js'
import { MarketInstallService, type MarketDesktopPnpm, type MarketDesktopProfile } from '../install/service.js'
interface AccountMarket { catalog(): Promise<unknown>; checkpoint(): void }
export function applyIpzsk(ctx: Context): void {
  ctx.inject(['desktopProfiles','desktopPnpm','desktopActions','ipzskMarket'], scope => {
    const profile = () => (scope.get('desktopProfiles') as { current: MarketDesktopProfile }).current
    const account = scope.get('ipzskMarket') as AccountMarket
    const actions = scope.get('desktopActions') as { requestRestart(): Promise<void> }
    const service = new MarketInstallService(profile, scope.get('desktopPnpm') as MarketDesktopPnpm, { verify: async () => { throw new Error('IPZSK 只支持审核版本。') } })
    const controller = new AbortController()
    scope.effect(() => () => { controller.abort(); service.dispose() }, 'ipzsk-market: lifecycle')
    const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' }); res.end(JSON.stringify(body))
    }
    for (const action of ['catalog','install','restart'] as const) scope.effect(() => scope.webServer.register({
      kind:'exact', path:'/api/ipzsk-market/' + action,
      handler: async (req,res) => {
        const mutation = action !== 'catalog'
        if (req.method !== (mutation ? 'POST' : 'GET') || !(mutation ? mutationAllowed(req,scope.webServer.port) : requestAllowed(req,scope.webServer.port))) { send(res,403,{error:'请求来源无效。'}); return }
        try {
          if (action === 'restart') {
            const body = await readJson(req,controller.signal) as { restartToken?: string }
            service.consumeRestartToken(body.restartToken ?? '')
            send(res,200,{ok:true}); await actions.requestRestart(); return
          }
          const plugins = approvedCatalog(await account.catalog())
          if (action === 'catalog') {
            const require = createRequire(pathToFileURL(join(profile().dir,'package.json')))
            const rows = await Promise.all(plugins.map(async p => {
              let installedVersion: string | undefined
              try { installedVersion = JSON.parse(await readFile(require.resolve(p.package_name + '/package.json'),'utf8')).version } catch {}
              return { ...p, installedVersion }
            }))
            send(res,200,{plugins:rows}); return
          }
          const body = await readJson(req,controller.signal) as { pluginId?: string; releaseId?: string }
          const plugin = plugins.find(p => p.id === body.pluginId && p.release_id === body.releaseId)
          if (!plugin) { send(res,409,{error:'该版本已变更或下架，请刷新市场。'}); return }
          account.checkpoint()
          const result = await service.installApproved(plugin,AbortSignal.any([controller.signal,AbortSignal.timeout(180_000)]))
          send(res,200,result)
        } catch (error) { send(res,502,{error: error instanceof Error ? error.message : '插件操作失败。'}) }
      },
    }), 'ipzsk-market: ' + action)
  })
}
