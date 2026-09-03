import { invoke } from '@tauri-apps/api/core'

export interface BridgeStatus {
  readonly connected: boolean
  readonly endpoint: string
  readonly protocol: number
  readonly serverVersion: string | null
  readonly lastError: string | null
  readonly lastLatencyMs: number | null
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
