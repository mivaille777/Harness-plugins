import { z, ZodError } from 'zod'
import { normalizeSelectionSnapshot, type SelectionSnapshot } from '../context/snapshot.js'

export const IPC_PROTOCOL_VERSION = 1 as const
export const IPC_MAX_FRAME_BYTES = 1024 * 1024

export const IPC_MESSAGE_TYPES = [
  'bridge.hello',
  'bridge.hello.result',
  'bridge.ping',
  'bridge.pong',
  'selection.update',
  'selection.updated',
  'selection.current',
  'selection.current.result',
  'selection.expand',
  'selection.expanded',
  'session.list',
  'session.list.result',
  'session.create',
  'session.created',
  'session.submit',
  'session.submitted',
  'session.subscribe',
  'session.subscribed',
  'session.cancel',
  'session.cancelled',
  'agent.event',
  'error.response',
] as const

export type IpcMessageType = (typeof IPC_MESSAGE_TYPES)[number]
export type ContextScope = 'selection' | 'local' | 'section' | 'page'
export type SessionDeliveryMode = 'queue' | 'steer'
export type AgentEventKind =
  | 'status'
  | 'assistant-delta'
  | 'assistant-complete'
  | 'tool-call'
  | 'tool-result'
  | 'error'

export type IpcErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_MESSAGE'
  | 'PROTOCOL_MISMATCH'
  | 'UNKNOWN_MESSAGE_TYPE'
  | 'FRAME_TOO_LARGE'
  | 'FRAME_LENGTH_MISMATCH'
  | 'DUPLICATE_REQUEST_ID'
  | 'REQUEST_TIMEOUT'
  | 'BRIDGE_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export interface IpcEnvelope<T extends IpcMessageType, P> {
  readonly protocol: typeof IPC_PROTOCOL_VERSION
  readonly id: string
  readonly type: T
  readonly payload: P
}

export interface BridgeHelloPayload {
  readonly client: {
    readonly name: string
    readonly version: string
    readonly platform: 'windows'
  }
  readonly supportedProtocols: readonly number[]
}

export interface BridgeHelloResultPayload {
  readonly server: { readonly name: string; readonly version: string }
  readonly protocol: typeof IPC_PROTOCOL_VERSION
  readonly capabilities: readonly string[]
}

export interface SelectionExpandPayload {
  readonly snapshotId: string
  readonly scope: ContextScope
}

export interface SelectionExpandedPayload {
  readonly snapshotId: string
  readonly scope: ContextScope
  readonly context: {
    readonly before?: string
    readonly after?: string
    readonly sectionText?: string
    readonly pageText?: string
  }
}

export interface SessionSummary {
  readonly id: string
  readonly title?: string
  readonly status?: 'idle' | 'running' | 'queued' | 'unknown'
}

export interface PromptTextPart {
  readonly type: 'text'
  readonly text: string
}

export interface AgentEventPayload {
  readonly sessionId: string
  readonly subscriptionId: string
  readonly requestId?: string
  readonly event: {
    readonly kind: AgentEventKind
    readonly data: {
      readonly cursor: number
      readonly persistent: boolean
      readonly value: unknown
    }
  }
}

export type IpcMessage =
  | IpcEnvelope<'bridge.hello', BridgeHelloPayload>
  | IpcEnvelope<'bridge.hello.result', BridgeHelloResultPayload>
  | IpcEnvelope<'bridge.ping', { readonly sentAt: number }>
  | IpcEnvelope<'bridge.pong', { readonly sentAt: number; readonly receivedAt: number }>
  | IpcEnvelope<'selection.update', { readonly snapshot: SelectionSnapshot }>
  | IpcEnvelope<'selection.updated', {
      readonly accepted: boolean
      readonly snapshotId: string
      readonly revision: number
      readonly reason?: 'stale-revision'
    }>
  | IpcEnvelope<'selection.current', Record<string, never>>
  | IpcEnvelope<'selection.current.result', { readonly snapshot: SelectionSnapshot | null }>
  | IpcEnvelope<'selection.expand', SelectionExpandPayload>
  | IpcEnvelope<'selection.expanded', SelectionExpandedPayload>
  | IpcEnvelope<'session.list', Record<string, never>>
  | IpcEnvelope<'session.list.result', { readonly sessions: readonly SessionSummary[] }>
  | IpcEnvelope<'session.create', { readonly cwd?: string; readonly agentPreset?: string }>
  | IpcEnvelope<'session.created', { readonly sessionId: string }>
  | IpcEnvelope<'session.submit', {
      readonly sessionId: string
      readonly requestId: string
      readonly mode: SessionDeliveryMode
      readonly content: readonly PromptTextPart[]
    }>
  | IpcEnvelope<'session.submitted', { readonly accepted: boolean; readonly requestId: string }>
  | IpcEnvelope<'session.subscribe', { readonly sessionId: string; readonly cursor?: number }>
  | IpcEnvelope<'session.subscribed', { readonly sessionId: string; readonly subscriptionId: string; readonly cursor?: number }>
  | IpcEnvelope<'session.cancel', { readonly sessionId: string }>
  | IpcEnvelope<'session.cancelled', { readonly sessionId: string; readonly cancelled: boolean }>
  | IpcEnvelope<'agent.event', AgentEventPayload>
  | IpcEnvelope<'error.response', {
      readonly code: IpcErrorCode
      readonly message: string
      readonly details?: unknown
    }>

const idSchema = z.string().min(1).max(128)
const nonEmptyString = z.string().min(1)
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const emptyPayloadSchema = z.object({}).strict()
const scopeSchema = z.enum(['selection', 'local', 'section', 'page'])
const deliveryModeSchema = z.enum(['queue', 'steer'])
const sessionStatusSchema = z.enum(['idle', 'running', 'queued', 'unknown'])
const agentEventKindSchema = z.enum([
  'status',
  'assistant-delta',
  'assistant-complete',
  'tool-call',
  'tool-result',
  'error',
])
const errorCodeSchema = z.enum([
  'INVALID_JSON',
  'INVALID_MESSAGE',
  'PROTOCOL_MISMATCH',
  'UNKNOWN_MESSAGE_TYPE',
  'FRAME_TOO_LARGE',
  'FRAME_LENGTH_MISMATCH',
  'DUPLICATE_REQUEST_ID',
  'REQUEST_TIMEOUT',
  'BRIDGE_UNAVAILABLE',
  'INTERNAL_ERROR',
])
const selectionSnapshotWireSchema = z.object({
  id: nonEmptyString.max(256),
  revision: nonNegativeSafeInteger,
  capturedAt: nonNegativeSafeInteger,
  selection: z.object({
    text: z.string(),
    language: z.string().optional(),
  }).strict(),
  source: z.object({
    kind: z.enum(['browser', 'pdf', 'word', 'desktop']),
    app: z.string().optional(),
    process: z.string().optional(),
    windowTitle: z.string().optional(),
  }).strict(),
  document: z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    filePath: z.string().optional(),
    section: z.string().optional(),
    frameUrl: z.string().optional(),
  }).strict().optional(),
  context: z.object({
    before: z.string().optional(),
    after: z.string().optional(),
    sectionText: z.string().optional(),
    pageAvailable: z.boolean(),
  }).strict(),
  capabilities: z.object({
    localContext: z.boolean(),
    sectionContext: z.boolean(),
    pageContext: z.boolean(),
    screenshot: z.boolean(),
  }).strict(),
  geometry: z.object({
    monitorId: z.string().optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
  }).strict().optional(),
  provider: nonEmptyString,
  confidence: z.number().finite(),
}).strict()

const envelopeSchema = z.object({
  protocol: z.number().int(),
  id: idSchema,
  type: z.string(),
  payload: z.unknown(),
}).strict()

export class IpcProtocolError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'IpcProtocolError'
  }
}

export function parseIpcMessage(input: string | unknown): IpcMessage {
  const value = typeof input === 'string' ? parseJson(input) : input
  let envelope: z.infer<typeof envelopeSchema>
  try {
    envelope = envelopeSchema.parse(value)
  } catch (error) {
    throw invalidMessage(error)
  }

  if (envelope.protocol !== IPC_PROTOCOL_VERSION) {
    throw new IpcProtocolError(
      'PROTOCOL_MISMATCH',
      `unsupported IPC protocol ${String(envelope.protocol)}; expected ${IPC_PROTOCOL_VERSION}`,
      { received: envelope.protocol, expected: IPC_PROTOCOL_VERSION },
    )
  }

  if (!(IPC_MESSAGE_TYPES as readonly string[]).includes(envelope.type)) {
    throw new IpcProtocolError('UNKNOWN_MESSAGE_TYPE', `unknown IPC message type: ${envelope.type}`)
  }

  const type = envelope.type as IpcMessageType
  try {
    return {
      protocol: IPC_PROTOCOL_VERSION,
      id: envelope.id,
      type,
      payload: parsePayload(type, envelope.payload),
    } as IpcMessage
  } catch (error) {
    if (error instanceof IpcProtocolError) throw error
    throw invalidMessage(error)
  }
}

export function safeParseIpcMessage(input: string | unknown):
  | { readonly success: true; readonly message: IpcMessage }
  | { readonly success: false; readonly error: IpcProtocolError } {
  try {
    return { success: true, message: parseIpcMessage(input) }
  } catch (error) {
    return {
      success: false,
      error: error instanceof IpcProtocolError
        ? error
        : new IpcProtocolError('INVALID_MESSAGE', String(error)),
    }
  }
}

export function stringifyIpcMessage(message: IpcMessage): string {
  return JSON.stringify(parseIpcMessage(message))
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch (error) {
    throw new IpcProtocolError('INVALID_JSON', 'IPC payload is not valid JSON', error)
  }
}

function parsePayload(type: IpcMessageType, payload: unknown): unknown {
  switch (type) {
    case 'bridge.hello':
      return z.object({
        client: z.object({
          name: nonEmptyString,
          version: nonEmptyString,
          platform: z.literal('windows'),
        }).strict(),
        supportedProtocols: z.array(nonNegativeSafeInteger).min(1),
      }).strict().parse(payload)
    case 'bridge.hello.result':
      return z.object({
        server: z.object({ name: nonEmptyString, version: nonEmptyString }).strict(),
        protocol: z.literal(IPC_PROTOCOL_VERSION),
        capabilities: z.array(nonEmptyString),
      }).strict().parse(payload)
    case 'bridge.ping':
      return z.object({ sentAt: nonNegativeSafeInteger }).strict().parse(payload)
    case 'bridge.pong':
      return z.object({
        sentAt: nonNegativeSafeInteger,
        receivedAt: nonNegativeSafeInteger,
      }).strict().parse(payload)
    case 'selection.update': {
      const parsed = z.object({ snapshot: z.unknown() }).strict().parse(payload)
      return { snapshot: parseSelectionSnapshot(parsed.snapshot) }
    }
    case 'selection.updated':
      return z.object({
        accepted: z.boolean(),
        snapshotId: nonEmptyString,
        revision: nonNegativeSafeInteger,
        reason: z.literal('stale-revision').optional(),
      }).strict().parse(payload)
    case 'selection.current':
    case 'session.list':
      return emptyPayloadSchema.parse(payload)
    case 'selection.current.result': {
      const parsed = z.object({ snapshot: z.unknown().nullable() }).strict().parse(payload)
      return { snapshot: parsed.snapshot === null ? null : parseSelectionSnapshot(parsed.snapshot) }
    }
    case 'selection.expand':
      return z.object({ snapshotId: nonEmptyString, scope: scopeSchema }).strict().parse(payload)
    case 'selection.expanded':
      return z.object({
        snapshotId: nonEmptyString,
        scope: scopeSchema,
        context: z.object({
          before: z.string().optional(),
          after: z.string().optional(),
          sectionText: z.string().optional(),
          pageText: z.string().optional(),
        }).strict(),
      }).strict().parse(payload)
    case 'session.list.result':
      return z.object({
        sessions: z.array(z.object({
          id: nonEmptyString,
          title: z.string().optional(),
          status: sessionStatusSchema.optional(),
        }).strict()),
      }).strict().parse(payload)
    case 'session.create':
      return z.object({ cwd: nonEmptyString.optional(), agentPreset: nonEmptyString.optional() }).strict().parse(payload)
    case 'session.created':
      return z.object({ sessionId: nonEmptyString }).strict().parse(payload)
    case 'session.submit':
      return z.object({
        sessionId: nonEmptyString,
        requestId: nonEmptyString,
        mode: deliveryModeSchema,
        content: z.array(z.object({ type: z.literal('text'), text: nonEmptyString }).strict()).min(1),
      }).strict().parse(payload)
    case 'session.submitted':
      return z.object({ accepted: z.boolean(), requestId: nonEmptyString }).strict().parse(payload)
    case 'session.subscribe':
      return z.object({ sessionId: nonEmptyString, cursor: nonNegativeSafeInteger.optional() }).strict().parse(payload)
    case 'session.subscribed':
      return z.object({ sessionId: nonEmptyString, subscriptionId: nonEmptyString, cursor: nonNegativeSafeInteger.optional() }).strict().parse(payload)
    case 'session.cancel':
      return z.object({ sessionId: nonEmptyString }).strict().parse(payload)
    case 'session.cancelled':
      return z.object({ sessionId: nonEmptyString, cancelled: z.boolean() }).strict().parse(payload)
    case 'agent.event':
      return z.object({
        sessionId: nonEmptyString,
        subscriptionId: nonEmptyString,
        requestId: nonEmptyString.optional(),
        event: z.object({
          kind: agentEventKindSchema,
          data: z.object({
            cursor: nonNegativeSafeInteger,
            persistent: z.boolean(),
            value: z.unknown(),
          }).strict(),
        }).strict(),
      }).strict().parse(payload)
    case 'error.response':
      return z.object({
        code: errorCodeSchema,
        message: nonEmptyString,
        details: z.unknown().optional(),
      }).strict().parse(payload)
  }
}

function parseSelectionSnapshot(input: unknown): SelectionSnapshot {
  return normalizeSelectionSnapshot(selectionSnapshotWireSchema.parse(input))
}

function invalidMessage(error: unknown): IpcProtocolError {
  if (error instanceof IpcProtocolError) return error
  if (error instanceof ZodError) {
    return new IpcProtocolError('INVALID_MESSAGE', 'IPC message failed schema validation', error.issues)
  }
  return new IpcProtocolError('INVALID_MESSAGE', error instanceof Error ? error.message : String(error))
}
