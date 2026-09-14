import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const api = vi.hoisted(() => {
  class SubmissionUnknownError extends Error {
    constructor(readonly sessionId: string, readonly requestId: string, message: string) { super(message) }
  }
  return {
    getCaptureStatus: vi.fn(),
    getCurrentSelection: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    expandSelection: vi.fn(),
    readSessionHistory: vi.fn(),
    pauseCapture: vi.fn(),
    resumeCapture: vi.fn(),
    submitSessionPrompt: vi.fn(),
    subscribeSession: vi.fn(),
    unsubscribeSession: vi.fn(),
    cancelSession: vi.fn(),
    SubmissionUnknownError,
  }
})

const events = vi.hoisted(() => ({ listen: vi.fn(), unlisten: vi.fn() }))
vi.mock('./api/bridge', () => api)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: vi.fn() }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: events.listen }))

const capture = {
  paused: false,
  phase: 'running',
  queueDepth: 0,
  lastTransitionAt: 1,
  lastError: null,
  metrics: {
    captured: 1,
    published: 1,
    deduplicated: 0,
    pausedDrops: 0,
    coalesced: 0,
    noSelection: 0,
    notApplicable: 0,
    excluded: 0,
    errors: 0,
    lastCaptureLatencyMs: 1,
  },
}

const snapshot = Object.freeze({
  id: 'snapshot-ec05',
  revision: 5,
  capturedAt: 5_000,
  selection: { text: 'EC05_SELECTION_SENTINEL' },
  source: { kind: 'browser', app: 'Chrome' },
  document: { title: 'EC05 fixture' },
  context: { before: 'captured-only-before', pageAvailable: false },
  capabilities: {
    localContext: true,
    sectionContext: false,
    pageContext: false,
    screenshot: false,
  },
  provider: 'fixture',
  confidence: 1,
})

function fifthSubmitArgument(call: number): unknown {
  return api.submitSessionPrompt.mock.calls[call]?.[4]
}

describe('EC-05 durable authorized material handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    events.listen.mockResolvedValue(events.unlisten)
    api.getCaptureStatus.mockResolvedValue(capture)
    api.getCurrentSelection.mockResolvedValue(snapshot)
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue('session-ec05')
    api.readSessionHistory.mockResolvedValue({ sessionId: 'session-ec05', capturedThroughCursor: 0, entries: [] })
    api.expandSelection.mockResolvedValue({
      snapshotId: 'snapshot-ec05',
      revision: 5,
      scope: 'local',
      completeness: 'partial',
      truncated: true,
      context: {
        before: 'EC05_AUTHORIZED_BEFORE_SENTINEL',
        after: 'EC05_AUTHORIZED_AFTER_SENTINEL',
      },
    })
    api.submitSessionPrompt.mockResolvedValue({
      sessionId: 'session-ec05',
      requestId: 'request-ec05',
      messageId: 'message-ec05',
      delivery: 'queued',
      duplicate: false,
    })
    api.subscribeSession.mockResolvedValue(undefined)
    api.unsubscribeSession.mockResolvedValue({ sessionId: 'session-ec05', subscriptionId: 'sub', released: true })
    api.cancelSession.mockResolvedValue(true)
  })

  async function authorizeLocal(): Promise<void> {
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    await screen.findByText('EC05_AUTHORIZED_BEFORE_SENTINEL')
    fireEvent.click(screen.getByRole('button', { name: 'Use local context for this request' }))
  }

  it('passes the exact frozen canonical local material as the fifth submit argument', async () => {
    render(<App />)
    await authorizeLocal()
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1))

    const canonical = fifthSubmitArgument(0) as Record<string, unknown>
    expect(canonical).toMatchObject({
      snapshotId: 'snapshot-ec05',
      revision: 5,
      authorizedScope: 'local',
      actualScope: 'local',
      completeness: 'partial',
      truncated: true,
      context: {
        before: 'EC05_AUTHORIZED_BEFORE_SENTINEL',
        after: 'EC05_AUTHORIZED_AFTER_SENTINEL',
      },
    })
    expect(Object.isFrozen(canonical)).toBe(true)
    expect(api.submitSessionPrompt.mock.calls[0]?.[3]).toBe(snapshot)
  })

  it('reuses the same canonical material object when an unknown submission is retried', async () => {
    api.submitSessionPrompt
      .mockRejectedValueOnce(new api.SubmissionUnknownError('session-recovered', 'request-recovered', 'reply lost'))
      .mockResolvedValueOnce({
        sessionId: 'session-recovered',
        requestId: 'request-recovered',
        messageId: 'message-recovered',
        delivery: 'queued',
        duplicate: true,
      })

    render(<App />)
    await authorizeLocal()
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    expect(await screen.findByText('Submission status unknown')).toBeInTheDocument()

    const firstPrompt = api.submitSessionPrompt.mock.calls[0]?.[1]
    const firstCanonical = fifthSubmitArgument(0)
    fireEvent.click(screen.getByRole('button', { name: 'Retry safely' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(2))

    expect(api.submitSessionPrompt.mock.calls[1]?.[1]).toBe(firstPrompt)
    expect(api.submitSessionPrompt.mock.calls[1]?.[2]).toBe('request-recovered')
    expect(fifthSubmitArgument(1)).toBe(firstCanonical)
  })
})
