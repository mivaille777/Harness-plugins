import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const api = vi.hoisted(() => {
  class SubmissionUnknownError extends Error {
    constructor(readonly sessionId: string, readonly requestId: string, message: string) {
      super(message)
    }
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

const eventApi = vi.hoisted(() => ({
  sessionHandler: null as null | ((event: { payload: unknown }) => void),
  selectionHandler: null as null | ((event: { payload: unknown }) => void),
  listen: vi.fn(),
  unlisten: vi.fn(),
}))

const hide = vi.hoisted(() => vi.fn())

vi.mock('./api/bridge', () => api)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: eventApi.listen }))

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  for (const child of Object.values(value)) deepFreeze(child)
  Object.freeze(value)
  return value
}

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

const selection = deepFreeze({
  id: 'ec01-s1',
  revision: 2,
  capturedAt: 1,
  selection: { text: 'EC01 selected text' },
  source: { kind: 'browser', app: 'Chrome' },
  document: { title: 'EC01 fixture page' },
  context: {
    before: 'Captured before',
    after: 'Captured after',
    sectionText: 'Captured section',
    pageAvailable: false,
  },
  capabilities: {
    localContext: true,
    sectionContext: true,
    pageContext: false,
    screenshot: false,
  },
  provider: 'browser-accessibility',
  confidence: 1,
})

const expansion = deepFreeze({
  snapshotId: 'ec01-s1',
  scope: 'local' as const,
  revision: 2,
  completeness: 'complete' as const,
  truncated: false,
  context: {
    before: 'EC01_LOCAL_BEFORE_SENTINEL',
    after: 'EC01_LOCAL_AFTER_SENTINEL',
  },
})

describe('EC-01 expanded context submission baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    eventApi.sessionHandler = null
    eventApi.selectionHandler = null
    eventApi.listen.mockImplementation(async (name: string, handler: (event: { payload: unknown }) => void) => {
      if (name === 'selection-captured') eventApi.selectionHandler = handler
      else eventApi.sessionHandler = handler
      return eventApi.unlisten
    })
    api.getCaptureStatus.mockResolvedValue(capture)
    api.getCurrentSelection.mockResolvedValue(selection)
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue('session-created')
    api.expandSelection.mockResolvedValue(expansion)
    api.readSessionHistory.mockResolvedValue({ sessionId: 'session-1', capturedThroughCursor: 0, entries: [] })
    api.pauseCapture.mockResolvedValue({ ...capture, paused: true, phase: 'paused' })
    api.resumeCapture.mockResolvedValue(capture)
    api.submitSessionPrompt.mockResolvedValue({ sessionId: 'session-1', requestId: 'request-1' })
    api.subscribeSession.mockResolvedValue(undefined)
    api.unsubscribeSession.mockResolvedValue({ sessionId: 'session-1', subscriptionId: 'subscription-1', released: true })
    api.cancelSession.mockResolvedValue(true)
  })

  it('keeps a loaded expansion preview-only and out of the current V3 submission', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))

    expect(await screen.findByText('EC01_LOCAL_BEFORE_SENTINEL')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1))

    const [, prompt, , submittedMaterial] = api.submitSessionPrompt.mock.calls[0] ?? []
    expect(submittedMaterial).toBe(selection)
    expect(String(prompt)).not.toContain('EC01_LOCAL_BEFORE_SENTINEL')
    expect(JSON.stringify(submittedMaterial)).not.toContain('EC01_LOCAL_BEFORE_SENTINEL')
  })

  it('invalidates a loaded expansion when the visible snapshot identity changes', async () => {
    const latest = deepFreeze({
      ...selection,
      id: 'ec01-s2',
      revision: 3,
      selection: { text: 'EC01 newer selected text' },
      document: { title: 'EC01 newer fixture page' },
    })
    api.getCurrentSelection.mockResolvedValueOnce(selection).mockResolvedValueOnce(latest)

    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    expect(await screen.findByText('EC01_LOCAL_BEFORE_SENTINEL')).toBeInTheDocument()

    await waitFor(() => expect(eventApi.selectionHandler).not.toBeNull())
    eventApi.selectionHandler?.({ payload: { snapshotId: 'ec01-s2', revision: 3 } })

    expect(await screen.findByText('EC01 newer selected text')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('EC01_LOCAL_BEFORE_SENTINEL')).not.toBeInTheDocument())
    expect(screen.queryByText('Context loaded completely')).not.toBeInTheDocument()
  })

  it('retries an unknown submission with the exact frozen snapshot even after loading context', async () => {
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
    expect(await screen.findByText('EC01_LOCAL_BEFORE_SENTINEL')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    expect(await screen.findByText('Submission status unknown')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry safely' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(2))

    expect(api.submitSessionPrompt.mock.calls[1]?.[0]).toBe('session-recovered')
    expect(api.submitSessionPrompt.mock.calls[1]?.[2]).toBe('request-recovered')
    expect(api.submitSessionPrompt.mock.calls[1]?.[1]).toBe(api.submitSessionPrompt.mock.calls[0]?.[1])
    expect(api.submitSessionPrompt.mock.calls[0]?.[3]).toBe(selection)
    expect(api.submitSessionPrompt.mock.calls[1]?.[3]).toBe(api.submitSessionPrompt.mock.calls[0]?.[3])
    expect(Object.isFrozen(api.submitSessionPrompt.mock.calls[1]?.[3])).toBe(true)
    expect(JSON.stringify(api.submitSessionPrompt.mock.calls[1]?.[3])).not.toContain('EC01_LOCAL_BEFORE_SENTINEL')
  })

  it.fails('allows explicit local-context authorization to become the frozen submitted material', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    expect(await screen.findByText('EC01_LOCAL_BEFORE_SENTINEL')).toBeInTheDocument()

    const authorize = screen.getByRole('button', { name: /use local context for this request/i })
    fireEvent.click(authorize)
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1))

    const submittedMaterial = api.submitSessionPrompt.mock.calls[0]?.[3]
    expect(submittedMaterial).toMatchObject({
      snapshotId: 'ec01-s1',
      revision: 2,
      authorizedScope: 'local',
      actualScope: 'local',
      completeness: 'complete',
      truncated: false,
      context: {
        before: 'EC01_LOCAL_BEFORE_SENTINEL',
        after: 'EC01_LOCAL_AFTER_SENTINEL',
      },
    })
  })
})
