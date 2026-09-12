/** Narrow bridge used only by the separate, desktop-owned market document. */
import type { IpzskMarketService } from './ipzsk-market-service.ts'

export const IPZSK_MARKET_IPC = { catalog: 'ipzsk-market:catalog', install: 'ipzsk-market:install' } as const
export const IPZSK_MARKET_URL = 'dsh-app://shell/ipzsk-market.html'

export interface IpzskMarketApi {
  catalog(): ReturnType<IpzskMarketService['catalog']>
  install(pluginId: string, releaseId: string): Promise<void>
}
