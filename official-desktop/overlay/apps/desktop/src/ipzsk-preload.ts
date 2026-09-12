/** Bundled separately as CommonJS for Electron's sandboxed account window. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPZSK_ACCOUNT_IPC, type IpzskAccountRequest, type IpzskAccountResult } from './ipzsk-account-api.ts'

contextBridge.exposeInMainWorld('ipzskAccount', {
  request: (request: IpzskAccountRequest): Promise<IpzskAccountResult> => ipcRenderer.invoke(IPZSK_ACCOUNT_IPC, request),
})
