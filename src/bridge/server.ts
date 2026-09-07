import { createServer, type Server, type Socket } from 'node:net'
import { Service, type Context } from '@deepseek-ai/cordis'
import { encodeIpcFrame, IpcFrameDecoder } from './frame.js'
import {
  IPC_PROTOCOL_VERSION,
  IpcProtocolError,
  type IpcErrorCode,
  type IpcMessage,
} from './protocol.js'
import { BridgeMessageRouter } from './router.js'
import { SelectionCompanionSessionService } from '../session/service.js'

export const DEFAULT_SELECTION_COMPANION_PIPE = String.raw`\\.\pipe\dsh-selection-companion-v1`
export const DEFAULT_BRIDGE_IDLE_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_BRIDGE_CLIENTS = 4
export const DEFAULT_MAX_PENDING_WRITE_BYTES = 4 * 1024 * 1024

export interface SelectionCompanionBridgeOptions {
  readonly endpoint?: string
  readonly enabled?: boolean
  readonly idleTimeoutMs?: number
  readonly maxClients?: number
  readonly maxPendingWriteBytes?: number
}

export interface SelectionCompanionBridgeStatus {
  readonly enabled: boolean
  readonly listening: boolean
  readonly endpoint: string
  readonly clients: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    selectionCompanionBridge: SelectionCompanionBridgeService
  }
}

/**
 * Windows named-pipe carrier for the Native Companion.
 * Business semantics remain in Harness services/router; this class only owns transport lifecycle.
 */
export class SelectionCompanionBridgeService extends Service {
  static inject = ['selectionContext', 'selectionCompanionSessions']

  private readonly endpointValue: string
  private readonly enabledValue: boolean
  private readonly idleTimeoutMs: number
  private readonly maxClients: number
  private readonly maxPendingWriteBytes: number
  private readonly clients = new Set<Socket>()
  private readonly router: BridgeMessageRouter
  private server: Server | undefined
  private listening = false

  constructor(ctx: Context, options: SelectionCompanionBridgeOptions = {}) {
    super(ctx, 'selectionCompanionBridge')
    this.endpointValue = options.endpoint
      ?? process.env.DSH_SELECTION_COMPANION_PIPE
      ?? DEFAULT_SELECTION_COMPANION_PIPE
    this.enabledValue = options.enabled
      ?? process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE !== '1'
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_BRIDGE_IDLE_TIMEOUT_MS
    this.maxClients = options.maxClients ?? DEFAULT_MAX_BRIDGE_CLIENTS
    this.maxPendingWriteBytes = options.maxPendingWriteBytes ?? DEFAULT_MAX_PENDING_WRITE_BYTES
    if (!Number.isSafeInteger(this.idleTimeoutMs) || this.idleTimeoutMs <= 0) {
      throw new RangeError('idleTimeoutMs must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.maxClients) || this.maxClients <= 0) {
      throw new RangeError('maxClients must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.maxPendingWriteBytes) || this.maxPendingWriteBytes <= 0) {
      throw new RangeError('maxPendingWriteBytes must be a positive safe integer')
    }
    this.router = new BridgeMessageRouter(ctx.selectionContext, ctx.selectionCompanionSessions)
  }

  get endpoint(): string {
    return this.endpointValue
  }

  status(): SelectionCompanionBridgeStatus {
    return {
      enabled: this.enabledValue && process.platform === 'win32',
      listening: this.listening,
      endpoint: this.endpointValue,
      clients: this.clients.size,
    }
  }

  async [Service.init](): Promise<void> {
    if (!this.enabledValue) {
      this.ctx.logger.info('selection companion native bridge disabled by environment')
      return
    }
    if (process.platform !== 'win32') {
      this.ctx.logger.warn('selection companion native bridge is Windows-only; named pipe not started')
      return
    }

    const server = createServer(socket => { this.accept(socket) })
    this.server = server

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        this.listening = true
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.endpointValue)
    })

    server.on('error', error => { this.ctx.logger.error(error) })
    this.ctx.logger.info(`selection companion native bridge listening on ${this.endpointValue}`)

    this.ctx.effect(() => async () => {
      await this.stop()
    }, 'selectionCompanionBridge.listen')
  }

  private accept(socket: Socket): void {
    if (this.clients.size >= this.maxClients) {
      socket.destroy(new Error('selection companion bridge client limit reached'))
      return
    }
    const decoder = new IpcFrameDecoder()
    this.clients.add(socket)
    socket.setNoDelay(true)
    socket.setTimeout(this.idleTimeoutMs)

    let writes = Promise.resolve()
    let pendingWriteBytes = 0
    let closed = false
    const write = (message: IpcMessage): void => {
      if (closed || socket.destroyed) return
      const frame = encodeIpcFrame(message)
      pendingWriteBytes += frame.byteLength
      if (pendingWriteBytes > this.maxPendingWriteBytes) {
        socket.destroy(new Error(`selection companion bridge pending writes exceeded ${this.maxPendingWriteBytes} bytes`))
        return
      }
      writes = writes.then(() => new Promise<void>((resolve, reject) => {
        if (closed || socket.destroyed) {
          resolve()
          return
        }
        socket.write(frame, error => {
          if (error == null) resolve()
          else reject(error)
        })
      })).finally(() => { pendingWriteBytes -= frame.byteLength })
      writes.catch(error => { socket.destroy(error) })
    }

    const subscriptions: { dispose(): void }[] = []
    socket.on('data', chunk => {
      try {
        const messages = decoder.push(chunk)
        for (const message of messages) {
          const queuedEvents: IpcMessage[] = []
          let responseWritten = false
          void this.router.handle(message, event => {
            if (responseWritten) write(event)
            else queuedEvents.push(event)
          }, subscription => {
            if (closed) subscription.dispose()
            else {
              subscriptions.push(subscription)
              socket.setTimeout(0)
            }
          }).then(response => {
            if (closed) return
            write(response)
            responseWritten = true
            for (const event of queuedEvents) write(event)
          }).catch(error => { write(this.errorResponse(error)) })
        }
      } catch (error) {
        const response = this.errorResponse(error)
        try {
          socket.end(encodeIpcFrame(response))
        } catch {
          socket.destroy()
        }
      }
    })

    socket.on('error', error => {
      this.ctx.logger.warn(error)
    })

    socket.on('timeout', () => {
      socket.destroy(new Error(`selection companion bridge idle timeout after ${this.idleTimeoutMs} ms`))
    })

    socket.once('close', () => {
      closed = true
      decoder.reset()
      for (const subscription of subscriptions) subscription.dispose()
      this.clients.delete(socket)
    })
  }

  private errorResponse(error: unknown): IpcMessage {
    const protocolError = error instanceof IpcProtocolError
      ? error
      : new IpcProtocolError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
    const code: IpcErrorCode = protocolError.code
    this.ctx.logger.warn(protocolError)
    return {
      protocol: IPC_PROTOCOL_VERSION,
      id: `bridge-error-${Date.now()}`,
      type: 'error.response',
      payload: {
        code,
        message: protocolError.message,
      },
    }
  }

  private async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.listening = false

    for (const socket of this.clients) socket.destroy()
    this.clients.clear()

    if (server === undefined || !server.listening) return
    await new Promise<void>(resolve => {
      server.close(() => { resolve() })
    })
  }
}
