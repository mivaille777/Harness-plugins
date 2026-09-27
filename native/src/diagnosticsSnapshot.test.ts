import { describe, expect, it } from 'vitest'
import { initialLensState } from './lens/store'
import { emptyLensPerformanceState, recordLensLatency } from './lens/performance'
import { buildDiagnosticsSnapshot, getBridgeHealth, type DiagnosticsInput } from './diagnosticsSnapshot'

const baseInput = (): DiagnosticsInput => ({
  bridge: {
    connected: true,
    endpoint: 'test-pipe',
    protocol: 4,
    serverVersion: '0.1.0',
    lastError: null,
    lastLatencyMs: 4,
    reconnectCount: 2,
    requestTimeoutCount: 3,
  },
  bridgeError: null,
  capture: {
    paused: false,
    phase: 'running',
    queueDepth: 0,
    lastTransitionAt: 1_200,
    lastError: null,
    metrics: {
      captured: 5,
      published: 4,
      deduplicated: 1,
      pausedDrops: 1,
      guardDrops: 2,
      focusDrops: 3,
      coalesced: 4,
      noSelection: 0,
      notApplicable: 0,
      excluded: 0,
      errors: 0,
      lastCaptureLatencyMs: 8,
      eventCaptureLatencyP50Ms: 18,
      eventCaptureLatencyP95Ms: 42,
      fallbackCaptureLatencyP50Ms: 7,
      fallbackCaptureLatencyP95Ms: 12,
    },
  },
  captureError: null,
  interaction: {
    captureSuppressed: false,
    shuttingDown: false,
    generation: 3,
    activeRequests: 0,
    activeModes: [],
  },
  interactionError: null,
  processMemoryStatus: {
    available: true,
    workingSetBytes: 52_428_800,
    privateBytes: 67_108_864,
    error: null,
  },
  processMemoryError: null,
  windowLifecycleStatus: { createdCount: 2, destroyedCount: 1, activeCount: 1 },
  windowLifecycleError: null,
  selection: {
    id: 'snapshot-1',
    revision: 7,
    capturedAt: 1_000,
    sourceWindowIdentity: {
      processId: 10,
      windowHandle: '0x1',
      capturedAt: 1_000,
      focusEpoch: 9,
      windowTitle: 'Private document title',
    },
    selection: { text: 'PRIVATE SELECTED TEXT' },
    source: { kind: 'browser', app: 'Chrome', windowTitle: 'Private browser title' },
    document: { title: 'Private document title', url: 'https://private.example/' },
    context: { before: 'Private nearby text', pageText: 'Private page body', pageAvailable: true },
    capabilities: { localContext: true, sectionContext: true, pageContext: true, screenshot: false },
    geometry: { x: 1, y: 2, width: 3, height: 4, precision: 'exact-range', anchorType: 'selection' },
    provider: 'browser-accessibility',
    confidence: 1,
  },
  selectionError: null,
  sessionCount: 2,
  sessionError: null,
  lens: { ...initialLensState, view: 'lens-open' },
  pinnedSnapshot: null,
  sessionId: 'session-1',
  requestId: 'request-1',
  lastEventSequence: 12,
  subscriptionState: 'active',
  generatedAt: 1_500,
})

describe('runtime diagnostics snapshot', () => {
  it('reports a connected bridge as unhealthy when selection.current fails', () => {
    expect(getBridgeHealth({
      bridge: baseInput().bridge,
      bridgeError: null,
      selectionError: 'bridge request timed out',
    })).toBe('unhealthy')
  })

  it('reports a failed live ping as unhealthy while status still says connected', () => {
    expect(getBridgeHealth({
      bridge: baseInput().bridge,
      bridgeError: 'ping timed out',
      selectionError: null,
    })).toBe('unhealthy')
  })

  it('marks a disconnected bridge as the overall runtime state', () => {
    const input = baseInput()
    const snapshot = buildDiagnosticsSnapshot({
      ...input,
      bridge: { ...input.bridge!, connected: false },
      selection: null,
      selectionError: null,
    })

    expect(snapshot.bridge.health).toBe('disconnected')
    expect(snapshot.overall).toBe('disconnected')
    expect(snapshot.harness.pluginLoaded).toBeNull()
  })

  it('copies diagnostic identifiers and counters without selected or page text', () => {
    const lensPerformance = recordLensLatency(
      recordLensLatency(emptyLensPerformanceState(), 'passiveEntryVisible', 23.5),
      'lensInteractive',
      90,
    )
    const snapshot = buildDiagnosticsSnapshot(baseInput(), lensPerformance)
    const serialized = JSON.stringify(snapshot)

    expect(snapshot.bridge.health).toBe('healthy')
    expect(snapshot.bridge.reconnectCount).toBe(2)
    expect(snapshot.bridge.requestTimeoutCount).toBe(3)
    expect(snapshot.capture.droppedTriggerCount).toBe(10)
    expect(snapshot.capture.eventLatencyP50Ms).toBe(18)
    expect(snapshot.capture.eventLatencyP95Ms).toBe(42)
    expect(snapshot.lens.passiveEntryVisibleLatencyP50Ms).toBe(23.5)
    expect(snapshot.lens.lensInteractiveLatencyP95Ms).toBe(90)
    expect(snapshot.lens.passiveEntryVisibleSampleCount).toBe(1)
    expect(snapshot.runtime).toEqual({
      memoryScope: 'native-companion-process',
      processMemoryAvailable: true,
      workingSetBytes: 52_428_800,
      privateBytes: 67_108_864,
      memoryError: null,
      windowCreatedCount: 2,
      windowDestroyedCount: 1,
      windowActiveCount: 1,
      windowLifecycleError: null,
    })
    expect(snapshot.capture.fallbackLatencyP50Ms).toBe(7)
    expect(snapshot.capture.fallbackLatencyP95Ms).toBe(12)
    expect(snapshot.selection.cacheAgeMs).toBe(500)
    expect(snapshot.session.lastEventSequence).toBe(12)
    expect(serialized).not.toContain('PRIVATE SELECTED TEXT')
    expect(serialized).not.toContain('Private nearby text')
    expect(serialized).not.toContain('Private page body')
    expect(serialized).not.toContain('Private document title')
    expect(serialized).not.toContain('private.example')
  })
})
