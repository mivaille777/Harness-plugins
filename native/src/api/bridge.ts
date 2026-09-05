import { invoke } from '@tauri-apps/api/core'

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
