import { describe, expect, it, vi } from 'vitest'
import type { IpzskAuth } from '../src/ipzsk-auth.ts'

const mock = vi.hoisted(() => {
  class Window {
    events = new Map<string, (...args: any[]) => void>()
    webEvents = new Map<string, (...args: any[]) => void>()
    webContents = {
      on: vi.fn((event, handler) => this.webEvents.set(event, handler)),
      executeJavaScript: vi.fn(async () => ({ email: 'demo@example.com', password: 'fixture-password', remember: false })),
    }
    once = vi.fn((event, handler) => this.events.set(event, handler))
    removeMenu = vi.fn()
    isDestroyed = vi.fn(() => false)
    destroy = vi.fn()
    loadFile = vi.fn(async () => {})
  }
  return { Window, create: vi.fn(() => new Window()) }
})
vi.mock('electron', () => ({ shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../src/local-window-policy.ts', () => ({ createDesktopLocalWindow: mock.create }))
vi.mock('../src/electron-reveal.ts', () => ({ revealApplication: vi.fn() }))
import { IpzskLoginWindow, ipzskLoginAction } from '../src/ipzsk-login-window.ts'

function setup() {
  const auth = { restore: vi.fn(async () => undefined), ready: vi.fn(async () => true),
    sendCode: vi.fn(async () => {}), signIn: vi.fn(async () => ({ id: '1', email: 'demo@example.com' })) }
  const result = new IpzskLoginWindow(auth as unknown as IpzskAuth).run()
  const window = mock.create.mock.results.at(-1)!.value as InstanceType<typeof mock.Window>
  const navigate = (href: string) => {
    const event = { preventDefault: vi.fn() }
    window.webEvents.get('will-navigate')!(event, href)
    expect(event.preventDefault).toHaveBeenCalled()
  }
  return { auth, result, window, navigate }
}

describe('IPZSK login startup gate', () => {
  it('accepts exact secret-free actions only', () => {
    expect(ipzskLoginAction('dsh-ipzsk-login://login')).toBe('login')
    for (const href of ['https://evil.test', 'dsh-ipzsk-login://login?otp=123456', 'dsh-ipzsk-login://login#x']) {
      expect(ipzskLoginAction(href)).toBeUndefined()
    }
  })
  it('only resolves success after the backend confirms login', async () => {
    const { auth, result, navigate, window } = setup()
    navigate('dsh-ipzsk-login://login')
    expect(await result).toEqual({ id: '1', email: 'demo@example.com' })
    expect(auth.signIn).toHaveBeenCalledWith('demo@example.com', 'fixture-password', false)
    expect(window.destroy).toHaveBeenCalled()
  })
  it('closing login returns no customer', async () => {
    const { result, window, auth } = setup()
    window.events.get('closed')!()
    expect(await result).toBeUndefined()
    expect(auth.signIn).not.toHaveBeenCalled()
  })
  it('blocks remote navigation without authenticating', async () => {
    const { navigate, auth, window, result } = setup()
    navigate('https://evil.test')
    expect(auth.signIn).not.toHaveBeenCalled()
    window.events.get('closed')!()
    await result
  })
  it('displays failures and leaves the gate closed for retry', async () => {
    const { navigate, auth, window, result } = setup()
    auth.ready.mockRejectedValueOnce(new Error('后台不可用'))
    navigate('dsh-ipzsk-login://retry')
    await vi.waitFor(() => expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('后台不可用')))
    expect(window.destroy).not.toHaveBeenCalled()
    window.events.get('closed')!()
    await result
  })
})
