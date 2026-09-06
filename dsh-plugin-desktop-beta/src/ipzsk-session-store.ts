import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import type { IpzskSessionStore } from './ipzsk-auth.ts'

/** Dedicated encrypted file, outside Harness profiles and browser storage. */
export function ipzskSessionStore(path: string): IpzskSessionStore {
  const available = (): boolean => safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  return {
    canRemember: available,
    read() {
      if (!available()) return undefined
      try { return safeStorage.decryptString(readFileSync(path)) } catch { return undefined }
    },
    write(cookie) {
      if (!available()) throw new Error('系统加密存储不可用，请取消“记住登录”后重试。')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = path + '.tmp'
      writeFileSync(temporary, safeStorage.encryptString(cookie), { mode: 0o600 })
      renameSync(temporary, path)
    },
    clear() { rmSync(path, { force: true }); rmSync(path + '.tmp', { force: true }) },
  }
}
