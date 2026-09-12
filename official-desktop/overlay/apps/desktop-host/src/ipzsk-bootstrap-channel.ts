/** One startup configuration exchange over the parent's private lifecycle channel. */

/** Receive startup data without putting credentials in argv, environment or files. */
export function receiveIpzskBootstrap(): Promise<unknown> {
  if (process.send === undefined || !process.connected) return Promise.reject(new Error('IPZSK requires its desktop parent'))
  return new Promise((resolve, reject) => {
    const finish = (error: Error | undefined, value?: unknown): void => {
      clearTimeout(timer)
      process.off('message', onMessage)
      process.off('disconnect', onDisconnect)
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const onDisconnect = (): void => { finish(new Error('IPZSK desktop disconnected during startup')) }
    const onMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || !('type' in message)
        || message.type !== 'ipzsk-bootstrap' || !('value' in message)) {
        finish(new Error('IPZSK received an invalid startup message'))
        return
      }
      finish(undefined, message.value)
    }
    const timer = setTimeout(() => { finish(new Error('IPZSK desktop startup timed out')) }, 15_000)
    process.on('message', onMessage)
    process.once('disconnect', onDisconnect)
    process.send?.({ type: 'ipzsk-bootstrap-ready', version: 1 }, (error: Error | null) => {
      if (error !== null) finish(new Error('IPZSK could not request startup configuration'))
    })
  })
}
