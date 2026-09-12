import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPZSK_ACCOUNT_IPC } from '../src/ipzsk-account-api.ts'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value: unknown) => Promise<unknown>>(),
  store: { canRemember: vi.fn(() => true), read: vi.fn(() => undefined), write: vi.fn(), clear: vi.fn() },
  openExternal: vi.fn(),
  windows: [] as unknown[],
}))

vi.mock('../src/ipzsk-session-store.ts', () => ({ ipzskSessionStore: () => mocks.store }))
vi.mock('electron', () => ({
  app: { getAppPath: () => '/fixture/ipzsk' },
  shell: { openExternal: mocks.openExternal },
  ipcMain: {
    handle: (channel: string, callback: (event: unknown, value: unknown) => Promise<unknown>) => mocks.handlers.set(channel, callback),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  BrowserWindow: class extends EventEmitter {
    destroyed = false
    shown = false
    readonly webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' }, setWindowOpenHandler: vi.fn(),
    })
    constructor(readonly options: unknown) { super(); mocks.windows.push(this) }
    removeMenu() {}
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    restore() {}
    show() { this.shown = true }
    hide() { this.shown = false }
    focus() {}
    async loadFile(path: string) { this.webContents.mainFrame.url = pathToFileURL(path).href }
    destroy() { this.destroyed = true; this.emit('closed') }
  },
}))

import { IpzskAccountController } from '../src/ipzsk-account.ts'

const token = 'ipz_' + 'x'.repeat(43)
const bootstrap = { token, default_model: 'backend-model', models: [{ id: 'backend-model', name: 'Backend model', contextWindow: 128000, maxTokens: 8192 }] }
const json = (value: unknown, headers?: HeadersInit) => new Response(JSON.stringify(value), { ...(headers ? { headers } : {}) })
const bill = { wallet: { available_points: '100.5', frozen_points: '0', token }, usage: { page: 1, page_size: 20, count: 1, rows: [
  { id: 'req-1', model: 'backend-model', created_at: null, charged_points: '0.1', billing_state: 'charged', input_tokens: 3, output_tokens: 1, token },
] }, token }

let controller: IpzskAccountController
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>
let onSignOut: ReturnType<typeof vi.fn<() => Promise<void>>>

function owner() {
  return mocks.windows[0] as { webContents: { mainFrame: { url: string } }; options: Record<string, unknown>; shown: boolean; destroy(): void }
}
function invoke(value: unknown, event?: unknown) {
  const window = owner()
  return mocks.handlers.get(IPZSK_ACCOUNT_IPC)!((event ?? { sender: window.webContents, senderFrame: window.webContents.mainFrame }), value) as Promise<{ ok: boolean; value: unknown; error?: string }>
}

beforeEach(() => {
  mocks.handlers.clear(); mocks.windows.length = 0
  onSignOut = vi.fn(async () => {})
  controller = new IpzskAccountController({ userDataDir: '/fixture/data', onSignOut })
  fetcher = vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname
    if (path === '/api/auth/sign-in/email') return json({}, { 'Set-Cookie': '__Secure-ipzsk_customer.session_token=fixture' })
    if (path === '/api/me/profile') return json({ user: { id: 'user-1', email: 'user@example.com' } })
    if (path === '/api/me/desktop/bootstrap') return json(bootstrap)
    if (path === '/api/me/wallet') return json(bill.wallet)
    if (path === '/api/me/usage') return json(bill.usage)
    if (path === '/api/me/vouchers/redeem') return json({ amount_points: '100', replayed: false, token })
    if (path === '/api/auth/sign-out') throw new Error('private connection error')
    throw new Error('unexpected fixture request')
  })
  vi.stubGlobal('fetch', fetcher)
  // IpzskAuth captures fetch at construction.
  controller = new IpzskAccountController({ userDataDir: '/fixture/data', onSignOut })
})
afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); vi.clearAllMocks() })

async function login() {
  await controller.openAccount()
  return invoke({ type: 'signIn', email: 'user@example.com', password: 'fixture-password', remember: false })
}

describe('isolated IPZSK account window', () => {
  it('uses a sandboxed account preload and a private in-memory partition', async () => {
    await controller.openAccount()
    expect(owner().options.webPreferences).toMatchObject({ nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true, partition: 'ipzsk-account' })
    expect(await invoke({ type: 'state' })).toEqual({ ok: true, value: { signedIn: false, email: '', canRemember: true } })
  })

  it('rejects another window and child frames even at the correct account URL', async () => {
    await controller.openAccount()
    const window = owner()
    await expect(invoke({ type: 'state' }, { sender: {}, senderFrame: window.webContents.mainFrame })).rejects.toThrow('非账户窗口')
    await expect(invoke({ type: 'state' }, { sender: window.webContents, senderFrame: { url: window.webContents.mainFrame.url } })).rejects.toThrow('非账户窗口')
    window.webContents.mainFrame.url = 'https://attacker.invalid/'
    await expect(invoke({ type: 'state' })).rejects.toThrow('非账户窗口')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('exposes only profile fields while the Host bootstrap remains in main', async () => {
    const result = await login()
    expect(result).toEqual({ ok: true, value: { signedIn: true, email: 'user@example.com', canRemember: true } })
    expect(JSON.stringify(result)).not.toContain(token)
    expect(controller.bootstrap()).toMatchObject({ version: 1, token, default_model: 'backend-model' })
    expect(owner().shown).toBe(false)
    await controller.openAccount()
    expect(owner().shown).toBe(true)
  })

  it('projects wallet, pagination, usage and redemption data without forwarding extra server fields', async () => {
    await login()
    const billing = await invoke({ type: 'billing', page: 1 })
    expect(billing.ok).toBe(true)
    expect(billing.value).toMatchObject({ wallet: { available_points: '100.5' }, usage: { count: 1, rows: [{ id: 'req-1' }] } })
    expect(JSON.stringify(billing)).not.toContain(token)
    expect(await invoke({ type: 'redeem', code: '  fixture-voucher  ' })).toEqual({ ok: true, value: { amount_points: '100', replayed: false } })
    const redeemCall = fetcher.mock.calls.find(call => String(call[0]).endsWith('/vouchers/redeem'))
    expect(redeemCall?.[1]?.body).toBe(JSON.stringify({ code: 'fixture-voucher' }))
  })

  it('rejects malformed requests and blocks billing until login', async () => {
    await controller.openAccount()
    for (const request of [{ type: 'billing', page: -1 }, { type: 'redeem', code: '' }, { type: 'state', extra: true }, { type: 'billing', page: 1 }]) {
      expect((await invoke(request)).ok).toBe(false)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('clears local login and starts Host shutdown even when remote sign-out is offline', async () => {
    await login()
    expect((await invoke({ type: 'signOut' })).ok).toBe(true)
    expect(mocks.store.clear).toHaveBeenCalled()
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(() => controller.bootstrap()).toThrow('请先登录')
  })

  it('closing login resolves the startup gate without starting a Host', async () => {
    const gate = controller.ensureSignedIn()
    await vi.waitFor(() => { expect(mocks.windows).toHaveLength(1) })
    owner().destroy()
    expect(await gate).toBe(false)
    expect(() => controller.bootstrap()).toThrow('请先登录')
  })
})
