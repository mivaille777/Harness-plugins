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

const selection = Object.freeze({
  id: 'ec04-snapshot',
  revision: 4,
  capturedAt: 1,
  selection: { text: 'EC04_SELECTION_SENTINEL' },
  source: { kind: 'browser', app: 'Chrome' },
  document: { title: 'EC04 fixture' },
  context: {
    before: 'CAPTURED_BUT_NOT_AUTHORIZED_BEFORE',
    after: 'CAPTURED_BUT_NOT_AUTHORIZED_AFTER',
    pageAvailable: false,
  },
  capabilities: {
    localContext: true,
    sectionContext: false,
    pageContext: false,
    screenshot: false,
  },
  provider: 'fixture',
  confidence: 1,
})

function submittedPrompt(call = 0): string {
  return String(api.submitSessionPrompt.mock.calls[call]?.[1] ?? '')
}

describe('EC-04 authorized material model input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    events.listen.mockResolvedValue(events.unlisten)
    api.getCaptureStatus.mockResolvedValue(capture)
    api.getCurrentSelection.mockResolvedValue(selection)
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue('session-ec04')
    api.readSessionHistory.mockResolvedValue({ sessionId: 'session-ec04', capturedThroughCursor: 0, entries: [] })
    api.expandSelection.mockResolvedValue({
      snapshotId: 'ec04-snapshot',
      revision: 4,
      scope: 'local',
      completeness: 'complete',
      truncated: false,
      context: {
        before: 'AUTHORIZED_LOCAL_BEFORE_SENTINEL',
        after: 'AUTHORIZED_LOCAL_AFTER_SENTINEL',
      },
    })
    api.submitSessionPrompt.mockResolvedValue({
      sessionId: 'session-ec04',
      requestId: 'request-ec04',
      messageId: 'message-ec04',
      delivery: 'queued',
      duplicate: false,
    })
    api.subscribeSession.mockResolvedValue(undefined)
    api.unsubscribeSession.mockResolvedValue({ sessionId: 'session-ec04', subscriptionId: 'sub', released: true })
    api.cancelSession.mockResolvedValue(true)
  })

  it('keeps loaded expanded context out of the send preview and model prompt until explicit authorization', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))

    const initialPreview = screen.getByTestId('request-material-preview')
    expect(initialPreview).toHaveTextContent('EC04_SELECTION_SENTINEL')
    expect(initialPreview).not.toHaveTextContent('CAPTURED_BUT_NOT_AUTHORIZED_BEFORE')

    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    expect(await screen.findByText('AUTHORIZED_LOCAL_BEFORE_SENTINEL')).toBeInTheDocument()
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection only')
    expect(screen.getByTestId('request-material-preview')).not.toHaveTextContent('AUTHORIZED_LOCAL_BEFORE_SENTINEL')

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1))
    expect(submittedPrompt()).toContain('EC04_SELECTION_SENTINEL')
    expect(submittedPrompt()).not.toContain('AUTHORIZED_LOCAL_BEFORE_SENTINEL')
    expect(submittedPrompt()).not.toContain('CAPTURED_BUT_NOT_AUTHORIZED_BEFORE')
  })

  it('uses the same canonical expanded material for send preview and model prompt after authorization', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    await screen.findByText('AUTHORIZED_LOCAL_BEFORE_SENTINEL')
    fireEvent.click(screen.getByRole('button', { name: 'Use local context for this request' }))

    const preview = screen.getByTestId('request-material-preview').textContent ?? ''
    expect(preview).toContain('AUTHORIZED_LOCAL_BEFORE_SENTINEL')
    expect(preview).toContain('AUTHORIZED_LOCAL_AFTER_SENTINEL')
    expect(preview).toContain('Authorized scope: local')

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1))
    const prompt = submittedPrompt()
    expect(prompt).toContain(preview)
    expect(prompt).toContain('AUTHORIZED_LOCAL_BEFORE_SENTINEL')
    expect(prompt).toContain('AUTHORIZED_LOCAL_AFTER_SENTINEL')
    expect(prompt).not.toContain('CAPTURED_BUT_NOT_AUTHORIZED_BEFORE')
  })

  it('retries an unknown submission with the exact same canonical model prompt', async () => {
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
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    await screen.findByText('AUTHORIZED_LOCAL_BEFORE_SENTINEL')
    fireEvent.click(screen.getByRole('button', { name: 'Use local context for this request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    expect(await screen.findByText('Submission status unknown')).toBeInTheDocument()

    const firstPrompt = submittedPrompt(0)
    fireEvent.click(screen.getByRole('button', { name: 'Retry safely' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(2))
    expect(submittedPrompt(1)).toBe(firstPrompt)
    expect(api.submitSessionPrompt.mock.calls[1]?.[2]).toBe('request-recovered')
  })
})
