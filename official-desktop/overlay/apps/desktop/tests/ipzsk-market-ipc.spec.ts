import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))
import { assertMarketSender } from '../src/ipzsk-market.ts'
import { IPZSK_MARKET_URL } from '../src/ipzsk-market-ipc.ts'

it('accepts only the market window main frame at the exact market document', () => {
  const frame = { url: IPZSK_MARKET_URL }
  const contents = { mainFrame: frame }
  const window = { isDestroyed: () => false, webContents: contents }
  const event = { sender: contents, senderFrame: frame }
  expect(() => assertMarketSender(event as never, window as never)).not.toThrow()
  for (const invalid of [{ ...event, sender: {} }, { ...event, senderFrame: { url: IPZSK_MARKET_URL } },
    { ...event, senderFrame: null }]) expect(() => assertMarketSender(invalid as never, window as never)).toThrow('来源')
  frame.url = 'dsh-app://shell/plugin-manager.html'
  expect(() => assertMarketSender(event as never, window as never)).toThrow('来源')
  frame.url = IPZSK_MARKET_URL
  expect(() => assertMarketSender(event as never, { ...window, isDestroyed: () => true } as never)).toThrow('来源')
  expect(() => assertMarketSender(event as never, undefined)).toThrow('来源')
})
