import type { SelectionContextService } from '../context/service.js'
import {
  IPC_PROTOCOL_VERSION,
  type IpcMessage,
} from './protocol.js'

export const BRIDGE_CAPABILITIES = [
  'bridge.ping',
  'selection.current',
  'selection.update',
] as const

export interface BridgeMessageRouterOptions {
  readonly pluginVersion?: string
  readonly now?: () => number
}

/** Pure request router shared by the real named-pipe server and unit tests. */
export class BridgeMessageRouter {
  private readonly pluginVersion: string
  private readonly now: () => number

  constructor(
    private readonly selectionContext: SelectionContextService,
    options: BridgeMessageRouterOptions = {},
  ) {
    this.pluginVersion = options.pluginVersion ?? '0.1.0'
    this.now = options.now ?? Date.now
  }

  handle(message: IpcMessage): IpcMessage {
    switch (message.type) {
      case 'bridge.hello': {
        if (!message.payload.supportedProtocols.includes(IPC_PROTOCOL_VERSION)) {
          return this.error(
            message.id,
            'PROTOCOL_MISMATCH',
            `native client does not advertise protocol ${IPC_PROTOCOL_VERSION}`,
          )
        }
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'bridge.hello.result',
          payload: {
            server: {
              name: 'dsh-selection-companion',
              version: this.pluginVersion,
            },
            protocol: IPC_PROTOCOL_VERSION,
            capabilities: [...BRIDGE_CAPABILITIES],
          },
        }
      }
      case 'bridge.ping':
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'bridge.pong',
          payload: {
            sentAt: message.payload.sentAt,
            receivedAt: this.now(),
          },
        }
      case 'selection.update': {
        const result = this.selectionContext.update(message.payload.snapshot)
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'selection.updated',
          payload: result.accepted
            ? {
                accepted: true,
                snapshotId: result.snapshot.id,
                revision: result.snapshot.revision,
              }
            : {
                accepted: false,
                snapshotId: result.snapshot.id,
                revision: result.snapshot.revision,
                reason: result.reason,
              },
        }
      }
      case 'selection.current':
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'selection.current.result',
          payload: { snapshot: this.selectionContext.current() ?? null },
        }
      default:
        return this.error(
          message.id,
          'BRIDGE_UNAVAILABLE',
          `${message.type} is defined by Protocol V1 but is not available in the Task 4 bridge`,
        )
    }
  }

  private error(
    id: string,
    code: 'PROTOCOL_MISMATCH' | 'BRIDGE_UNAVAILABLE',
    message: string,
  ): IpcMessage {
    return {
      protocol: IPC_PROTOCOL_VERSION,
      id,
      type: 'error.response',
      payload: { code, message },
    }
  }
}
