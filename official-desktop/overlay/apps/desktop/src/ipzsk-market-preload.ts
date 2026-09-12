/** Sandboxed preload exposing reviewed IDs only, with no raw IPC surface. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPZSK_MARKET_IPC, type IpzskMarketApi } from './ipzsk-market-ipc.ts'

const api: IpzskMarketApi = {
  catalog: () => ipcRenderer.invoke(IPZSK_MARKET_IPC.catalog) as ReturnType<IpzskMarketApi['catalog']>,
  install: (pluginId, releaseId) => ipcRenderer.invoke(IPZSK_MARKET_IPC.install, pluginId, releaseId) as Promise<void>,
}
contextBridge.exposeInMainWorld('ipzskMarket', api)
