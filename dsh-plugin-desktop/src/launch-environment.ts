import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

/** Resolve the desktop credential in memory, without exposing it to child processes. */
export function withIpzskCredential(
  environment: LaunchEnvironmentSnapshot,
  credential: () => string,
): LaunchEnvironmentSnapshot {
  const entry = () => ({ value: credential(), source: 'process' as const })
  return Object.freeze({
    get: (name: string) => name === 'IPZSK_DESKTOP_API_KEY' ? entry() : environment.get(name),
    getFrom: (name: string, sources: Parameters<LaunchEnvironmentSnapshot['getFrom']>[1]) => {
      if (name === 'IPZSK_DESKTOP_API_KEY') return sources.includes('process') ? entry() : undefined
      return environment.getFrom(name, sources)
    },
  })
}

export function withDesktopDshHome(
  environment: LaunchEnvironmentSnapshot,
  homeDir: string,
): LaunchEnvironmentSnapshot {
  const entry = Object.freeze({ value: homeDir, source: 'process' as const })
  return Object.freeze({
    get: (name: string) => name.toUpperCase() === 'DSH_HOME' ? entry : environment.get(name),
    getFrom: (name: string, sources: Parameters<LaunchEnvironmentSnapshot['getFrom']>[1]) => {
      return name.toUpperCase() === 'DSH_HOME' && sources.includes('process')
        ? entry
        : environment.getFrom(name, sources)
    },
  })
}
