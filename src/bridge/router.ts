import type { SelectionContextService } from '../context/service.js'
import type { SelectionCompanionSessionService, SessionAgentEvent, SessionSubscription } from '../session/service.js'
import {
  IPC_PROTOCOL_VERSION,
  type IpcMessage,
} from './protocol.js'

export const BRIDGE_CAPABILITIES = [
  'bridge.ping',
  'selection.current',
  'selection.update',
  'session.list',
  'session.create',
  'session.submit.queue',
  'session.submit.steer',
  'session.subscribe',
  'session.cancel',
] as const

export interface BridgeMessageRouterOptions {
  readonly pluginVersion?: string
  readonly now?: () => number
}

export interface BridgeSubscription {
  dispose(): void
}

export type BridgeEventListener = (message: IpcMessage) => void
export type BridgeSubscriptionListener = (subscription: SessionSubscription) => void

/** Pure request router shared by the real named-pipe server and unit tests. */
export class BridgeMessageRouter {
  private readonly pluginVersion: string
  private readonly now: () => number

  constructor(
    private readonly selectionContext: SelectionContextService,
    private readonly sessions: Pick<SelectionCompanionSessionService, 'list' | 'create' | 'submit' | 'cancel' | 'subscribe'>,
    options: BridgeMessageRouterOptions = {},
  ) {
    this.pluginVersion = options.pluginVersion ?? '0.1.0'
    this.now = options.now ?? Date.now
  }

  async handle(
    message: IpcMessage,
    eventListener?: BridgeEventListener,
    subscriptionListener?: BridgeSubscriptionListener,
  ): Promise<IpcMessage> {
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
      case 'session.list': {
        const sessions = await this.sessions.list()
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'session.list.result',
          payload: { sessions },
        }
      }
      case 'session.create': {
        if (message.payload.agentPreset !== undefined) {
          return this.error(message.id, 'BRIDGE_UNAVAILABLE', 'agentPreset selection is not available through the native bridge')
        }
        const sessionId = await this.sessions.create(message.payload.cwd)
        return { protocol: IPC_PROTOCOL_VERSION, id: message.id, type: 'session.created', payload: { sessionId } }
      }
      case 'session.submit': {
        await this.sessions.submit(message.payload.sessionId, message.payload.requestId, message.payload.mode, message.payload.content)
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'session.submitted',
          payload: { accepted: true, requestId: message.payload.requestId },
        }
      }
      case 'session.subscribe': {
        if (eventListener === undefined) return this.error(message.id, 'BRIDGE_UNAVAILABLE', 'session subscriptions require a live bridge connection')
        const subscription = await this.sessions.subscribe(message.payload.sessionId, message.payload.cursor, event => {
          eventListener(this.agentEvent(message.id, message.payload.sessionId, event))
        })
        subscriptionListener?.(subscription)
        return {
          protocol: IPC_PROTOCOL_VERSION,
          id: message.id,
          type: 'session.subscribed',
          payload: {
            sessionId: message.payload.sessionId,
            subscriptionId: message.id,
            ...(message.payload.cursor === undefined ? {} : { cursor: message.payload.cursor }),
          },
        }
      }
      case 'session.cancel': {
        const cancelled = this.sessions.cancel(message.payload.sessionId)
        return { protocol: IPC_PROTOCOL_VERSION, id: message.id, type: 'session.cancelled', payload: { sessionId: message.payload.sessionId, cancelled } }
      }
      default:
        return this.error(
          message.id,
          'BRIDGE_UNAVAILABLE',
          `${message.type} is defined by Protocol V1 but is not available in the Task 4 bridge`,
        )
    }
  }

  private agentEvent(id: string, sessionId: string, event: SessionAgentEvent): IpcMessage {
    return {
      protocol: IPC_PROTOCOL_VERSION,
      id,
      type: 'agent.event',
      payload: {
        sessionId,
        subscriptionId: id,
        ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
        event: { kind: event.kind, data: { cursor: event.cursor, persistent: event.persistent, value: event.data } },
      },
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
