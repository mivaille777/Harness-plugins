import type {
  BridgeStatus,
  CaptureStatus,
  InteractionStatus,
  ProcessMemoryStatus,
  SelectionCacheStatus,
  WindowLifecycleStatus,
} from './api/bridge'
import type { LensState } from './lens/store'
import { emptyLensPerformanceState, type LensPerformanceState } from './lens/performance'
import type { SelectionSnapshot } from '../../src/context/snapshot.js'

export type BridgeHealth = 'healthy' | 'unhealthy' | 'disconnected' | 'unknown'

export interface DiagnosticsInput {
  readonly bridge: BridgeStatus | null
  readonly bridgeError: string | null
  readonly capture: CaptureStatus | null
  readonly captureError: string | null
  readonly interaction: InteractionStatus | null
  readonly interactionError: string | null
  readonly processMemoryStatus: ProcessMemoryStatus | null
  readonly processMemoryError: string | null
  readonly windowLifecycleStatus: WindowLifecycleStatus | null
  readonly windowLifecycleError: string | null
  readonly selectionCacheStatus: SelectionCacheStatus | null
  readonly selectionCacheError: string | null
  readonly selection: SelectionSnapshot | null
  readonly selectionError: string | null
  readonly sessionCount: number | null
  readonly sessionError: string | null
  readonly lens: LensState
  readonly pinnedSnapshot: SelectionSnapshot | null
  readonly sessionId: string | null
  readonly requestId: string | null
  readonly lastEventSequence: number | null
  readonly subscriptionState: string
  readonly generatedAt: number
}

export function getBridgeHealth(input: Pick<DiagnosticsInput, 'bridge' | 'bridgeError' | 'selectionError'>): BridgeHealth {
  if (input.bridge === null) return 'unknown'
  if (!input.bridge.connected) return 'disconnected'
  if (input.bridgeError !== null || input.selectionError !== null) return 'unhealthy'
  return 'healthy'
}

/** Build a copyable runtime snapshot without selected text, document titles, or URLs. */
export function buildDiagnosticsSnapshot(
  input: DiagnosticsInput,
  lensPerformance: LensPerformanceState = emptyLensPerformanceState(),
) {
  const selection = input.selection
  const capture = input.capture
  const bridgeHealth = getBridgeHealth(input)
  const droppedTriggers = capture === null
    ? null
    : capture.metrics.pausedDrops
      + capture.metrics.guardDrops
      + capture.metrics.focusDrops
      + capture.metrics.coalesced

  return {
    generatedAt: input.generatedAt,
    overall: bridgeHealth === 'unhealthy'
      || input.sessionError !== null
      || input.captureError !== null
      || input.interactionError !== null
      ? 'unhealthy'
      : bridgeHealth,
    harness: {
      version: null,
      profile: null,
      pluginLoaded: input.bridge === null || !input.bridge.connected
        ? null
        : input.bridge.serverVersion !== null,
      pluginVersion: input.bridge?.serverVersion ?? null,
      sessionAdapter: input.sessionError === null && input.sessionCount !== null
        ? 'healthy'
        : input.sessionError === null ? 'unknown' : 'unhealthy',
      sessionCount: input.sessionCount,
      error: input.sessionError,
    },
    bridge: {
      health: bridgeHealth,
      connected: input.bridge?.connected ?? false,
      protocol: input.bridge?.protocol ?? null,
      pipe: input.bridge?.endpoint ?? null,
      latencyMs: input.bridge?.lastLatencyMs ?? null,
      latencyP50Ms: input.bridge?.latencyP50Ms ?? null,
      latencyP95Ms: input.bridge?.latencyP95Ms ?? null,
      latencySampleCount: input.bridge?.latencySampleCount ?? 0,
      reconnectCount: input.bridge?.reconnectCount ?? null,
      requestTimeoutCount: input.bridge?.requestTimeoutCount ?? null,
      lastError: input.bridge?.lastError ?? input.bridgeError,
      selectionCurrentError: input.selectionError,
    },
    capture: {
      provider: selection?.provider ?? input.pinnedSnapshot?.provider ?? null,
      state: capture?.phase ?? null,
      lastEventAt: capture?.lastTransitionAt ?? null,
      latencyMs: capture?.metrics.lastCaptureLatencyMs ?? null,
      eventLatencyP50Ms: capture?.metrics.eventCaptureLatencyP50Ms ?? null,
      eventLatencyP95Ms: capture?.metrics.eventCaptureLatencyP95Ms ?? null,
      fallbackLatencyP50Ms: capture?.metrics.fallbackCaptureLatencyP50Ms ?? null,
      fallbackLatencyP95Ms: capture?.metrics.fallbackCaptureLatencyP95Ms ?? null,
      deduplicatedCount: capture?.metrics.deduplicated ?? null,
      droppedTriggerCount: droppedTriggers,
      pausedDrops: capture?.metrics.pausedDrops ?? null,
      guardDrops: capture?.metrics.guardDrops ?? null,
      focusDrops: capture?.metrics.focusDrops ?? null,
      coalesced: capture?.metrics.coalesced ?? null,
      error: capture?.lastError ?? input.captureError,
    },
    selection: {
      state: input.selectionError !== null ? 'unavailable' : selection === null ? 'no-selection' : 'available',
      snapshotId: selection?.id ?? null,
      revision: selection?.revision ?? null,
      sourceKind: selection?.source.kind ?? null,
      sourceApp: selection?.source.app ?? null,
      provider: selection?.provider ?? null,
      capabilities: selection?.capabilities ?? null,
      geometryPrecision: selection?.geometry?.precision ?? null,
      geometryAnchorType: selection?.geometry?.anchorType ?? null,
      cacheAgeMs: selection === null ? null : Math.max(0, input.generatedAt - selection.capturedAt),
      cacheMetricSupported: input.selectionCacheStatus?.supported ?? false,
      cacheSize: input.selectionCacheStatus?.size ?? null,
      cacheError: input.selectionCacheError,
      error: input.selectionError,
    },
    lens: {
      state: input.lens.view,
      requestState: input.lens.request.phase,
      pinnedSnapshotId: input.pinnedSnapshot?.id ?? null,
      pinnedRevision: input.pinnedSnapshot?.revision ?? null,
      focusEpoch: input.pinnedSnapshot?.sourceWindowIdentity?.focusEpoch ?? null,
      interactionMode: input.interaction?.activeModes ?? null,
      captureSuppressed: input.interaction?.captureSuppressed ?? null,
      interactionError: input.interactionError,
      passiveEntryVisibleSampleCount: lensPerformance.passiveEntryVisible.sampleCount,
      passiveEntryVisibleLatencyP50Ms: lensPerformance.passiveEntryVisible.p50Ms,
      passiveEntryVisibleLatencyP95Ms: lensPerformance.passiveEntryVisible.p95Ms,
      lensInteractiveSampleCount: lensPerformance.lensInteractive.sampleCount,
      lensInteractiveLatencyP50Ms: lensPerformance.lensInteractive.p50Ms,
      lensInteractiveLatencyP95Ms: lensPerformance.lensInteractive.p95Ms,
    },
    runtime: {
      memoryScope: 'native-companion-process',
      processMemoryAvailable: input.processMemoryStatus?.available ?? false,
      workingSetBytes: input.processMemoryStatus?.workingSetBytes ?? null,
      privateBytes: input.processMemoryStatus?.privateBytes ?? null,
      memoryError: input.processMemoryStatus?.error ?? input.processMemoryError,
      windowCreatedCount: input.windowLifecycleStatus?.createdCount ?? null,
      windowDestroyedCount: input.windowLifecycleStatus?.destroyedCount ?? null,
      windowActiveCount: input.windowLifecycleStatus?.activeCount ?? null,
      windowLifecycleError: input.windowLifecycleError,
    },
    session: {
      boundSessionId: input.sessionId,
      requestId: input.requestId,
      lastEventSequence: input.lastEventSequence,
      subscriptionState: input.subscriptionState,
    },
  }
}
