/** Separate Electron-owned market window; Host and other renderers cannot mutate packages. */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { IPZSK_MARKET_IPC, IPZSK_MARKET_URL } from './ipzsk-market-ipc.ts'
import { IpzskMarketService, type IpzskMarketOptions } from './ipzsk-market-service.ts'

export function assertMarketSender(event: IpcMainInvokeEvent, window: BrowserWindow | undefined): void {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== IPZSK_MARKET_URL) {
    throw new Error('插件市场请求来源无效。')
  }
}

export function createIpzskMarket(options: IpzskMarketOptions): { open(): void; dispose(): void } {
  let window: BrowserWindow | undefined
  const service = new IpzskMarketService(options)
  ipcMain.handle(IPZSK_MARKET_IPC.catalog, (event) => {
    assertMarketSender(event, window)
    return service.catalog()
  })
  ipcMain.handle(IPZSK_MARKET_IPC.install, (event, pluginId: unknown, releaseId: unknown) => {
    assertMarketSender(event, window)
    return service.install(pluginId, releaseId)
  })
  return {
    open() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return }
      window = new BrowserWindow({ width: 900, height: 650, minWidth: 650, minHeight: 480, show: false,
        title: 'IPZSK 插件市场', webPreferences: {
          preload: fileURLToPath(new URL('./ipzsk-market-preload.cjs', import.meta.url)),
          nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        } })
      const opened = window
      opened.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      opened.webContents.on('will-navigate', event => { event.preventDefault() })
      opened.webContents.on('will-attach-webview', event => { event.preventDefault() })
      opened.once('ready-to-show', () => { if (!opened.isDestroyed()) opened.show() })
      opened.once('closed', () => { if (window === opened) window = undefined })
      void opened.loadURL(IPZSK_MARKET_URL).catch(() => { if (!opened.isDestroyed()) opened.close() })
    },
    dispose() {
      service.dispose()
      ipcMain.removeHandler(IPZSK_MARKET_IPC.catalog)
      ipcMain.removeHandler(IPZSK_MARKET_IPC.install)
      if (window && !window.isDestroyed()) window.close()
      window = undefined
    },
  }
}
