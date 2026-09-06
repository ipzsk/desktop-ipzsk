import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptString: vi.fn((_value: string) => Buffer.from('encrypted-test-data')),
  decryptString: vi.fn((_value: Buffer) => 'signed-test-cookie'),
}))
vi.mock('electron', () => ({ safeStorage }))
import { ipzskSessionStore } from '../src/ipzsk-session-store.ts'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
})

describe('IPZSK encrypted session storage', () => {
  it('only writes ciphertext and can remove the saved session', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ipzsk-session-test-'))
    directories.push(directory)
    const path = join(directory, 'ipzsk/session.enc')
    const store = ipzskSessionStore(path)
    expect(store.read()).toBeUndefined()
    store.write('signed-test-cookie')
    expect(readFileSync(path, 'utf8')).toBe('encrypted-test-data')
    expect(store.read()).toBe('signed-test-cookie')
    store.clear()
    expect(store.read()).toBeUndefined()
  })
  it('never falls back to plaintext if OS encryption is unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ipzsk-session-test-'))
    directories.push(directory)
    safeStorage.isEncryptionAvailable.mockReturnValue(false)
    const store = ipzskSessionStore(join(directory, 'session.enc'))
    expect(store.canRemember()).toBe(false)
    expect(() => store.write('signed-test-cookie')).toThrow('系统加密存储不可用')
  })
})
