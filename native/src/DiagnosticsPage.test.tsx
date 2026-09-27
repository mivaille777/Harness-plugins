import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionSnapshot } from '../../src/context/snapshot.js'
import { initialLensState } from './lens/store'
import { emptyLensPerformanceState, recordLensLatency } from './lens/performance'
import DiagnosticsPage from './DiagnosticsPage'

const bridgeMocks = vi.hoisted(() => ({
  getBridgeStatus: vi.fn(),
  getCaptureStatus: vi.fn(),
  getCurrentSelection: vi.fn(),
  getInteractionGuardStatus: vi.fn(),
  getProcessMemoryStatus: vi.fn(),
  getWindowLifecycleStatus: vi.fn(),
  listSessions: vi.fn(),
  pingBridge: vi.fn(),
}))

vi.mock('./api/bridge', () => bridgeMocks)

describe('DiagnosticsPage', () => {
  beforeEach(() => {
    const connectedBridge = {
      connected: true,
      endpoint: 'test-pipe',
      protocol: 4,
      serverVersion: '0.1.0',
      lastError: null,
      lastLatencyMs: 5,
      reconnectCount: 1,
      requestTimeoutCount: 3,
    }
    bridgeMocks.getBridgeStatus.mockResolvedValue(connectedBridge)
    bridgeMocks.pingBridge.mockResolvedValue(connectedBridge)
    bridgeMocks.getCaptureStatus.mockResolvedValue({
      paused: false,
      phase: 'running',
      queueDepth: 0,
      lastTransitionAt: 100,
      lastError: null,
      metrics: {
        captured: 1,
        published: 1,
        deduplicated: 0,
        pausedDrops: 0,
        guardDrops: 0,
        focusDrops: 0,
        coalesced: 0,
        noSelection: 0,
        notApplicable: 0,
        excluded: 0,
        errors: 0,
        lastCaptureLatencyMs: 6,
        eventCaptureLatencyP50Ms: 18,
        eventCaptureLatencyP95Ms: 42,
        fallbackCaptureLatencyP50Ms: 7,
        fallbackCaptureLatencyP95Ms: 12,
      },
    })
    bridgeMocks.getInteractionGuardStatus.mockResolvedValue({
      captureSuppressed: false,
      shuttingDown: false,
      generation: 0,
      activeRequests: 0,
      activeModes: [],
    })
    bridgeMocks.getProcessMemoryStatus.mockResolvedValue({
      available: true,
      workingSetBytes: 52_428_800,
      privateBytes: 67_108_864,
      error: null,
    })
    bridgeMocks.getWindowLifecycleStatus.mockResolvedValue({ createdCount: 2, destroyedCount: 0, activeCount: 2 })
    bridgeMocks.getCurrentSelection.mockRejectedValue(new Error('request timed out'))
    bridgeMocks.listSessions.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('joins a failed selection probe with the connected bridge as unhealthy', async () => {
    const onBack = vi.fn()
    render(
      <DiagnosticsPage
        locale="en-US"
        lens={initialLensState}
        lensPerformance={emptyLensPerformanceState()}
        pinnedSnapshot={null}
        sessionId={null}
        requestId={null}
        lastEventSequence={null}
        subscriptionState="idle"
        onBack={onBack}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('diagnostics-page')).toBeInTheDocument())
    await waitFor(() => expect(bridgeMocks.getCurrentSelection).toHaveBeenCalledOnce())
    expect(screen.getAllByText('unhealthy').length).toBeGreaterThan(0)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Request timeouts')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Runtime' })).toBeInTheDocument()
    expect(screen.getByText('Working set')).toBeInTheDocument()
    expect(screen.getByText('50.0 MiB')).toBeInTheDocument()
    expect(screen.getByText('Private bytes')).toBeInTheDocument()
    expect(screen.getByText('64.0 MiB')).toBeInTheDocument()
    expect(screen.getByText('Windows created').parentElement).toHaveTextContent('2')
    expect(screen.getByText('Windows destroyed').parentElement).toHaveTextContent('0')
    expect(screen.getByText('Windows active').parentElement).toHaveTextContent('2')
    expect(screen.getAllByText('Error: request timed out').length).toBeGreaterThan(0)
    for (const heading of ['Harness', 'Bridge', 'Capture', 'Runtime', 'Selection', 'Lens', 'Session']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }

    fireEvent.click(screen.getByRole('button', { name: /Back to Lens/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows event and fallback capture latency percentiles separately', async () => {
    render(
      <DiagnosticsPage
        locale="en-US"
        lens={initialLensState}
        lensPerformance={recordLensLatency(
          recordLensLatency(emptyLensPerformanceState(), 'passiveEntryVisible', 23.5),
          'lensInteractive',
          90,
        )}
        pinnedSnapshot={null}
        sessionId={null}
        requestId={null}
        lastEventSequence={null}
        subscriptionState="idle"
        onBack={() => undefined}
      />,
    )

    expect(await screen.findByText('UIA event to snapshot P50')).toBeInTheDocument()
    expect(screen.getByText('18 ms')).toBeInTheDocument()
    expect(screen.getByText('UIA event to snapshot P95')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()
    expect(screen.getByText('Fallback provider P50')).toBeInTheDocument()
    expect(screen.getByText('7 ms')).toBeInTheDocument()
    expect(screen.getByText('Fallback provider P95')).toBeInTheDocument()
    expect(screen.getByText('12 ms')).toBeInTheDocument()
  })

  it('copies a useful snapshot without selection text or document details', async () => {
    bridgeMocks.getCurrentSelection.mockResolvedValue({
      id: 'snapshot-private',
      revision: 3,
      capturedAt: Date.now(),
      selection: { text: 'PRIVATE SELECTED CONTENT' },
      source: { kind: 'browser', app: 'Chrome', windowTitle: 'PRIVATE WINDOW TITLE' },
      document: { title: 'PRIVATE DOCUMENT TITLE', url: 'https://private.example/' },
      context: { before: 'PRIVATE PAGE CONTEXT', pageText: 'PRIVATE PAGE BODY', pageAvailable: true },
      capabilities: { localContext: true, sectionContext: true, pageContext: true, screenshot: false },
      geometry: { x: 1, y: 2, width: 3, height: 4, precision: 'exact-range', anchorType: 'selection' },
      provider: 'browser-accessibility',
      confidence: 1,
    } as unknown as SelectionSnapshot)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(
      <DiagnosticsPage
        locale="en-US"
        lens={initialLensState}
        lensPerformance={emptyLensPerformanceState()}
        pinnedSnapshot={null}
        sessionId="session-1"
        requestId="request-1"
        lastEventSequence={5}
        subscriptionState="active"
        onBack={() => undefined}
      />,
    )

    const copyButton = await screen.findByRole('button', { name: 'Copy diagnostics snapshot' })
    await waitFor(() => expect(copyButton).toBeEnabled())
    fireEvent.click(copyButton)
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())

    const serialized = writeText.mock.calls[0]?.[0] as string
    expect(serialized).toContain('snapshot-private')
    expect(serialized).toContain('session-1')
    expect(serialized).not.toContain('PRIVATE SELECTED CONTENT')
    expect(serialized).not.toContain('PRIVATE PAGE CONTEXT')
    expect(serialized).not.toContain('PRIVATE PAGE BODY')
    expect(serialized).not.toContain('PRIVATE DOCUMENT TITLE')
    expect(serialized).not.toContain('private.example')
  })
})
