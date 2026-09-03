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

export const DEFAULT_SELECTION_COMPANION_PIPE = String.raw`\\.\pipe\dsh-selection-companion-v1`

export interface SelectionCompanionBridgeOptions {
  readonly endpoint?: string
  readonly enabled?: boolean
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
  private readonly endpointValue: string
  private readonly enabledValue: boolean
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
    this.router = new BridgeMessageRouter(ctx.selectionContext)
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
    const decoder = new IpcFrameDecoder()
    this.clients.add(socket)

    socket.on('data', chunk => {
      try {
        const messages = decoder.push(chunk)
        for (const message of messages) {
          const response = this.router.handle(message)
          socket.write(encodeIpcFrame(response))
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

    socket.once('close', () => {
      decoder.reset()
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
