import { describe, expect, it, vi } from 'vitest'
import { IpzskAuth, IPZSK_ORIGIN, type IpzskSessionStore } from '../src/ipzsk-auth.ts'

const cookie = '__Secure-ipzsk_customer.session_token=test-session.signature'
const customer = { id: 'customer-1', email: 'demo@example.com' }
const modelConfig = { token: 'ipz_' + 'x'.repeat(43), default_model: 'gpt-5.6-sol', models: [{ id: 'gpt-5.6-sol', name: 'Sol', contextWindow: 128000, maxTokens: 8192 }] }
const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, ...(headers === undefined ? {} : { headers }) })
function fixture(saved?: string) {
  const store: IpzskSessionStore = { canRemember: vi.fn(() => true), read: vi.fn(() => saved), write: vi.fn(), clear: vi.fn() }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/desktop/bootstrap')) return json(modelConfig)
    throw new Error('unexpected request')
  })
  const auth = new IpzskAuth(store, fetcher)
  return { store, fetcher, auth }
}

describe('IPZSK customer authentication', () => {
  it('validates input before sending anything', async () => {
    const { auth, fetcher } = fixture()
    await expect(auth.signIn('bad', 'password', false)).rejects.toThrow('有效邮箱')
    await expect(auth.signIn(customer.email, '', false)).rejects.toThrow('密码')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('verifies the gateway profile before remembering the signed cookie, then obtains a session-bound model credential', async () => {
    const { auth, fetcher, store } = fixture()
    fetcher.mockResolvedValueOnce(json({ token: 'not-for-renderer' }, 200, { 'Set-Cookie': cookie + '; Secure; HttpOnly; Path=/' }))
      .mockResolvedValueOnce(json({ user: customer, credential: { prefix: 'ipz_test' } }))
    expect(await auth.signIn(customer.email, 'fixture-password', true)).toEqual(customer)
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ Cookie: cookie })
    expect(store.write).toHaveBeenCalledWith(cookie)
    expect(auth.credential()).toBe(modelConfig.token)
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ email: customer.email, password: 'fixture-password' }))
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      IPZSK_ORIGIN + '/api/auth/sign-in/email', IPZSK_ORIGIN + '/api/me/profile', IPZSK_ORIGIN + '/api/me/desktop/bootstrap',
    ])
  })

  it('does not persist a session unless explicitly selected', async () => {
    const { auth, fetcher, store } = fixture()
    fetcher.mockResolvedValueOnce(json({}, 200, { 'Set-Cookie': cookie })).mockResolvedValueOnce(json({ user: customer }))
    await auth.signIn(customer.email, 'fixture-password', false)
    expect(store.write).not.toHaveBeenCalled()
  })

  it('checks secure storage before sending the password', async () => {
    const { auth, fetcher, store } = fixture()
    vi.mocked(store.canRemember).mockReturnValue(false)
    await expect(auth.signIn(customer.email, 'fixture-password', true)).rejects.toThrow('取消“记住登录”')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a success response with no signed session cookie', async () => {
    const { auth, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(json({ token: 'unsigned-value' }))
    await expect(auth.signIn(customer.email, 'fixture-password', false)).rejects.toThrow('有效的登录会话')
  })

  it.each([401, 403])('clears an expired or disabled saved session (%s)', async status => {
    const { auth, fetcher, store } = fixture(cookie)
    fetcher.mockResolvedValueOnce(json({}, status))
    expect(await auth.restore()).toBeUndefined()
    expect(store.clear).toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
  })

  it('never trusts a cached account when the server cannot be reached', async () => {
    const { auth, fetcher, store } = fixture(cookie)
    fetcher.mockRejectedValueOnce(new Error('network detail with secrets'))
    await expect(auth.restore()).rejects.toThrow('无法连接')
    expect(store.clear).not.toHaveBeenCalled()
  })

  it('rejects untrusted cookie material from storage without making a request', async () => {
    const { auth, fetcher, store } = fixture('admin_session=secret')
    expect(await auth.restore()).toBeUndefined()
    expect(store.clear).toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refreshes a remembered session only after a valid profile response', async () => {
    const { auth, fetcher, store } = fixture(cookie)
    fetcher.mockResolvedValueOnce(json({ user: customer }, 200, { 'Set-Cookie': cookie + '-renewed; HttpOnly' }))
    expect(await auth.restore()).toEqual(customer)
    expect(store.write).toHaveBeenCalledWith(cookie + '-renewed')
  })

  it('reports unavailable email service and rate limits without leaking response bodies', async () => {
    const { auth, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(json({ password_login_ready: false }))
    expect(await auth.ready()).toBe(false)
    fetcher.mockResolvedValueOnce(json({ detail: 'private server internals' }, 429))
    await expect(auth.signIn(customer.email, 'password', false)).rejects.toThrow('操作太频繁')
  })

  it('forgets this device on logout even when the remote sign-out fails', async () => {
    const { auth, fetcher, store } = fixture(cookie)
    fetcher.mockResolvedValueOnce(json({ user: customer }))
    await auth.restore()
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await expect(auth.signOut()).rejects.toThrow('无法连接')
    expect(store.clear).toHaveBeenCalled()
    expect(() => auth.credential()).toThrow('登录已失效')
    fetcher.mockResolvedValueOnce(json({ password_login_ready: true }))
    await auth.ready()
    expect(fetcher.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty('Cookie')
  })
})
