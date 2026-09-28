import { invoke } from '@tauri-apps/api/core'
import type { AgentEventKind, ContextScope, SelectionExpandedPayload } from '../../../src/bridge/protocol.js'
import type { SelectionSnapshot } from '../../../src/context/snapshot.js'
import type { SelectionMaterial } from '../../../src/session/material.js'

const nativeCommands = [
  'bridge_status',
  'bridge_connect',
  'bridge_ping',
  'bridge_disconnect',
  'bridge_current_selection',
  'bridge_selection_cache_status',
  'bridge_expand_selection',
  'bridge_submit_prompt',
  'bridge_list_sessions',
  'bridge_create_session',
  'bridge_choose_workspace_and_create_session',
  'bridge_read_session_history',
  'bridge_subscribe_session',
  'bridge_unsubscribe_session',
  'bridge_cancel_session',
  'capture_status',
  'capture_pause',
  'capture_resume',
  'interaction_guard_begin',
  'interaction_guard_end',
  'interaction_guard_status',
  'restore_source_focus',
  'runtime_memory_status',
  'runtime_window_lifecycle_status',
] as const

type NativeCommand = typeof nativeCommands[number]

/** Keep Tauri IPC behind the typed command allowlist and these domain wrappers. */
function invokeNative<T>(command: NativeCommand, args?: Record<string, unknown>): Promise<T> {
  return args === undefined ? invoke<T>(command) : invoke<T>(command, args)
}

export interface BridgeStatus {
  readonly connected: boolean
  readonly endpoint: string
  readonly protocol: number
  readonly serverVersion: string | null
  readonly lastError: string | null
  readonly lastLatencyMs: number | null
  readonly latencyP50Ms: number | null
  readonly latencyP95Ms: number | null
  readonly latencySampleCount: number
  readonly reconnectCount: number
  readonly requestTimeoutCount: number
}

export interface ProcessMemoryStatus {
  readonly available: boolean
  readonly workingSetBytes: number | null
  readonly privateBytes: number | null
  readonly error: string | null
}

export interface WindowLifecycleStatus {
  readonly createdCount: number
  readonly destroyedCount: number
  readonly activeCount: number
}

export interface SelectionCacheStatus {
  readonly supported: boolean
  readonly size: number | null
}

export interface CaptureMetrics {
  readonly captured: number
  readonly published: number
  readonly deduplicated: number
  readonly pausedDrops: number
  readonly guardDrops: number
  readonly focusDrops: number
  readonly coalesced: number
  readonly noSelection: number
  readonly notApplicable: number
  readonly excluded: number
  readonly errors: number
  readonly lastCaptureLatencyMs: number | null
  readonly eventCaptureLatencyP50Ms: number | null
  readonly eventCaptureLatencyP95Ms: number | null
  readonly fallbackCaptureLatencyP50Ms: number | null
  readonly fallbackCaptureLatencyP95Ms: number | null
}

export interface CaptureStatus {
  readonly paused: boolean
  readonly phase: 'running' | 'paused' | 'noSelection' | 'notApplicable' | 'excluded' | 'error' | 'publishing'
  readonly queueDepth: number
  readonly lastTransitionAt: number
  readonly lastError: string | null
  readonly metrics: CaptureMetrics
}

export type InteractionMode = 'agentInput' | 'screenCapture' | 'lensInteraction' | 'capturePaused' | 'shutdown'

export interface InteractionStatus {
  readonly captureSuppressed: boolean
  readonly shuttingDown: boolean
  readonly generation: number
  readonly activeRequests: number
  readonly activeModes: readonly InteractionMode[]
}

export type FocusRestoreReason =
  | 'restored'
  | 'noSourceIdentity'
  | 'sourceExpired'
  | 'userChangedFocus'
  | 'sourceWindowUnavailable'
  | 'sourceProcessUnavailable'
  | 'processMismatch'
  | 'windowTitleChanged'
  | 'windowMinimized'
  | 'focusDenied'
  | 'shuttingDown'
  | 'unsupportedPlatform'

export interface FocusRestoreResult {
  readonly restored: boolean
  readonly reason: FocusRestoreReason
}

export interface SessionSubmission {
  readonly sessionId: string
  readonly requestId: string
  readonly messageId: string
  readonly delivery: 'queued' | 'steered'
  readonly duplicate: boolean
}

export interface SessionSummary {
  readonly id: string
  readonly title?: string
  readonly status?: 'idle' | 'running' | 'queued' | 'unknown'
  readonly createdAt?: number
  readonly live?: boolean
  readonly persisted?: boolean
}

export interface SessionHistoryEntry {
  readonly seq: number
  readonly time: number
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly sourceKind?: string
  readonly requestId?: string
}

export interface SessionHistoryPage {
  readonly sessionId: string
  readonly nextCursor?: number
  readonly capturedThroughCursor: number
  readonly entries: readonly SessionHistoryEntry[]
}

/** Result of an explicitly requested context projection for one fixed snapshot. */
export type SelectionExpansion = SelectionExpandedPayload

export interface SessionUnsubscription {
  readonly sessionId: string
  readonly subscriptionId: string
  readonly released: boolean
}

export class SubmissionUnknownError extends Error {
  constructor(
    readonly sessionId: string,
    readonly requestId: string,
    message: string,
  ) {
    super(message)
    this.name = 'SubmissionUnknownError'
  }
}

/** A durable Harness event delivered over the dedicated session pipe. */
export interface SessionAgentEvent {
  readonly sessionId: string
  readonly subscriptionId: string
  readonly requestId?: string
  readonly requestIds?: readonly string[]
  readonly history?: SessionHistoryEntry
  readonly event?: {
    readonly kind: AgentEventKind
    readonly data: {
      readonly cursor: number
      readonly persistent: boolean
      readonly value: unknown
    }
  }
  readonly error?: string
}

export function getBridgeStatus(): Promise<BridgeStatus> {
  return invokeNative<BridgeStatus>('bridge_status')
}

export interface WorkspaceSession {
  readonly sessionId: string
  readonly cwd: string
}

export function getProcessMemoryStatus(): Promise<ProcessMemoryStatus> {
  return invokeNative<ProcessMemoryStatus>('runtime_memory_status')
}

export function getWindowLifecycleStatus(): Promise<WindowLifecycleStatus> {
  return invokeNative<WindowLifecycleStatus>('runtime_window_lifecycle_status')
}

export function connectBridge(): Promise<BridgeStatus> {
  return invokeNative<BridgeStatus>('bridge_connect')
}

export function pingBridge(): Promise<BridgeStatus> {
  return invokeNative<BridgeStatus>('bridge_ping')
}

export function disconnectBridge(): Promise<BridgeStatus> {
  return invokeNative<BridgeStatus>('bridge_disconnect')
}

export function getCaptureStatus(): Promise<CaptureStatus> {
  return invokeNative<CaptureStatus>('capture_status')
}

export function getInteractionGuardStatus(): Promise<InteractionStatus> {
  return invokeNative<InteractionStatus>('interaction_guard_status')
}

export function pauseCapture(): Promise<CaptureStatus> {
  return invokeNative<CaptureStatus>('capture_pause')
}

export function resumeCapture(): Promise<CaptureStatus> {
  return invokeNative<CaptureStatus>('capture_resume')
}

/** Starts or refreshes a bounded capture-suppression guard for one operation. */
export function beginInteractionGuard(
  mode: InteractionMode,
  requestId: string,
  timeoutMs = 30_000,
): Promise<InteractionStatus> {
  return invokeNative<InteractionStatus>('interaction_guard_begin', { mode, requestId, timeoutMs })
}

/** Ends exactly the matching capture-suppression guard. */
export function endInteractionGuard(
  mode: InteractionMode,
  requestId: string,
): Promise<InteractionStatus> {
  return invokeNative<InteractionStatus>('interaction_guard_end', { mode, requestId })
}

/** Requests a safety-checked focus restore for a native-captured source snapshot. */
export function restoreSourceFocus(snapshotId: string, revision: number): Promise<FocusRestoreResult> {
  return invokeNative<FocusRestoreResult>('restore_source_focus', { snapshotId, revision })
}

export function getCurrentSelection(): Promise<SelectionSnapshot | null> {
  return invokeNative<SelectionSnapshot | null>('bridge_current_selection')
}

export function getSelectionCacheStatus(): Promise<SelectionCacheStatus> {
  return invokeNative<SelectionCacheStatus>('bridge_selection_cache_status')
}

/** Requests bounded context already captured for the selected snapshot. */
export function expandSelection(snapshotId: string, scope: ContextScope): Promise<SelectionExpansion> {
  return invokeNative<SelectionExpansion>('bridge_expand_selection', { snapshotId, scope })
}

/** Lists live and persisted Harness sessions exposed by the bridge. */
export function listSessions(): Promise<readonly SessionSummary[]> {
  return invokeNative<readonly SessionSummary[]>('bridge_list_sessions')
}

/** Creates one Harness session in the host's configured working directory. */
export function createSession(): Promise<string> {
  return invokeNative<string>('bridge_create_session')
}

/** Lets the native OS picker choose a folder before creating a Harness session in it. */
export function chooseWorkspaceAndCreateSession(): Promise<WorkspaceSession | null> {
  return invokeNative<WorkspaceSession | null>('bridge_choose_workspace_and_create_session')
}

/** Reads one bounded durable history page; callers follow nextCursor to load more. */
export function readSessionHistory(
  sessionId: string,
  afterCursor?: number,
  limit?: number,
): Promise<SessionHistoryPage> {
  return invokeNative<SessionHistoryPage>('bridge_read_session_history', {
    sessionId,
    ...(afterCursor === undefined ? {} : { afterCursor }),
    ...(limit === undefined ? {} : { limit }),
  })
}

/**
 * Submit a fixed request. Existing callers may omit authorizedMaterial and keep
 * the legacy SelectionSnapshot fallback; Lens passes canonical material so
 * Protocol V4 can persist exactly what the user authorized.
 */
export async function submitSessionPrompt(
  sessionId: string | null,
  content: string,
  requestId: string,
  materialSnapshot: SelectionSnapshot,
  authorizedMaterial?: SelectionMaterial,
): Promise<SessionSubmission> {
  const material = authorizedMaterial ?? materialSnapshot
  try {
    return await invokeNative<SessionSubmission>('bridge_submit_prompt', { sessionId, content, requestId, material })
  } catch (error) {
    const message = String(error)
    const match = /^SUBMISSION_UNKNOWN\|([^|]+)\|([^|]+)\|(.*)$/s.exec(message)
    if (match !== null) throw new SubmissionUnknownError(match[1]!, match[2]!, match[3]!)
    throw error
  }
}

/** Opens a pipe owned solely by the event stream for one Harness session. */
export function subscribeSession(sessionId: string, subscriptionId: string, cursor?: number): Promise<void> {
  return invokeNative<void>('bridge_subscribe_session', { sessionId, subscriptionId, cursor })
}

/** Releases exactly one dedicated session subscription pipe. */
export function unsubscribeSession(sessionId: string, subscriptionId: string): Promise<SessionUnsubscription> {
  return invokeNative<SessionUnsubscription>('bridge_unsubscribe_session', { sessionId, subscriptionId })
}

/** Requests the Harness cancellation operation for the selected session only. */
export function cancelSession(sessionId: string): Promise<boolean> {
  return invokeNative<boolean>('bridge_cancel_session', { sessionId })
}
