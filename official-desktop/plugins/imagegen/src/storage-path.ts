import path from 'node:path'
let directory: string | undefined
/** One desktop Host owns one image store; package updates keep this directory. */
export function configureStorage(dataDir: string): void {
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) throw new Error('AI 生图需要 IPZSK 宿主提供绝对路径 ipzskDesktop.dataDir')
  const next = path.join(dataDir, 'dsh-imagegen')
  if (directory !== undefined && directory !== next) throw new Error('AI 生图数据目录已由当前宿主管理')
  directory = next
}
/** Resolve only under the current Host-owned data directory. */
export function storagePath(...parts: string[]): string {
  if (directory === undefined) throw new Error('AI 生图数据目录尚未由宿主初始化')
  return path.join(directory, ...parts)
}
