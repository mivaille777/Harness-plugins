import { invoke } from '@tauri-apps/api/core'
import type { AgentEventKind } from '../../../src/bridge/protocol.js'
import type { SelectionSnapshot } from '../../../src/context/snapshot.js'

export interface BridgeStatus {
  readonly connected: boolean
  readonly endpoint: string
  readonly protocol: number
  readonly serverVersion: string | null
  readonly lastError: string | null
  readonly lastLatencyMs: number | null
}

export interface CaptureMetrics {
  readonly captured: number
  readonly published: number
  readonly deduplicated: number
  readonly pausedDrops: number
  readonly coalesced: number
  readonly noSelection: number
  readonly notApplicable: number
  readonly excluded: number
  readonly errors: number
  readonly lastCaptureLatencyMs: number | null
}

export interface CaptureStatus {
  readonly paused: boolean
  readonly phase: 'running' | 'paused' | 'noSelection' | 'notApplicable' | 'excluded' | 'error' | 'publishing'
  readonly queueDepth: number
  readonly lastTransitionAt: number
  readonly lastError: string | null
  readonly metrics: CaptureMetrics
}

export interface SessionSubmission {
  readonly sessionId: string
  readonly requestId: string
}

/** A durable Harness event delivered over the dedicated session pipe. */
export interface SessionAgentEvent {
  readonly sessionId: string
  readonly subscriptionId: string
  readonly requestId?: string
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
  return invoke<BridgeStatus>('bridge_status')
}

export function connectBridge(): Promise<BridgeStatus> {
  return invoke<BridgeStatus>('bridge_connect')
}

export function pingBridge(): Promise<BridgeStatus> {
  return invoke<BridgeStatus>('bridge_ping')
}

export function disconnectBridge(): Promise<BridgeStatus> {
  return invoke<BridgeStatus>('bridge_disconnect')
}

export function getCaptureStatus(): Promise<CaptureStatus> {
  return invoke<CaptureStatus>('capture_status')
}

export function pauseCapture(): Promise<CaptureStatus> {
  return invoke<CaptureStatus>('capture_pause')
}

export function resumeCapture(): Promise<CaptureStatus> {
  return invoke<CaptureStatus>('capture_resume')
}

export function getCurrentSelection(): Promise<SelectionSnapshot | null> {
  return invoke<SelectionSnapshot | null>('bridge_current_selection')
}

export function submitSessionPrompt(sessionId: string | null, content: string): Promise<SessionSubmission> {
  return invoke<SessionSubmission>('bridge_submit_prompt', { sessionId, content })
}

/** Opens a pipe owned solely by the event stream for one Harness session. */
export function subscribeSession(sessionId: string, subscriptionId: string, cursor?: number): Promise<void> {
  return invoke<void>('bridge_subscribe_session', { sessionId, subscriptionId, cursor })
}

/** Requests the Harness cancellation operation for the selected session only. */
export function cancelSession(sessionId: string): Promise<boolean> {
  return invoke<boolean>('bridge_cancel_session', { sessionId })
}
