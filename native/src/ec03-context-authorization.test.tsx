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

function freeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
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

const selection = freeze({
  id: 'ec03-s1',
  revision: 2,
  capturedAt: 1,
  selection: { text: 'EC03 selected text' },
  source: { kind: 'browser', app: 'Chrome' },
  document: { title: 'EC03 fixture page' },
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

describe('EC-03 Lens context authorization', () => {
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
    api.expandSelection.mockImplementation(async (snapshotId: string, scope: 'local' | 'section' | 'page') => ({
      snapshotId,
      revision: 2,
      scope,
      completeness: 'complete',
      truncated: false,
      context: scope === 'local'
        ? { before: 'EC03_LOCAL_BEFORE', after: 'EC03_LOCAL_AFTER' }
        : scope === 'section'
          ? { sectionText: 'EC03_SECTION_TEXT' }
          : { pageText: 'EC03_PAGE_TEXT' },
    }))
    api.readSessionHistory.mockResolvedValue({ sessionId: 'session-1', capturedThroughCursor: 0, entries: [] })
    api.pauseCapture.mockResolvedValue({ ...capture, paused: true, phase: 'paused' })
    api.resumeCapture.mockResolvedValue(capture)
    api.submitSessionPrompt.mockResolvedValue({ sessionId: 'session-1', requestId: 'request-1' })
    api.subscribeSession.mockResolvedValue(undefined)
    api.unsubscribeSession.mockResolvedValue({ sessionId: 'session-1', subscriptionId: 'subscription-1', released: true })
    api.cancelSession.mockResolvedValue(true)
  })

  it('keeps a loaded preview selection-only until the user explicitly authorizes it', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))

    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection only')
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    expect(await screen.findByText('EC03_LOCAL_BEFORE')).toBeInTheDocument()
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection only')

    const authorize = screen.getByRole('button', { name: 'Use local context for this request' })
    fireEvent.click(authorize)
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection + local context')
    expect(screen.queryByRole('button', { name: 'Use local context for this request' })).not.toBeInTheDocument()
  })

  it('revokes expanded authorization when the requested preview scope changes', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    await screen.findByText('EC03_LOCAL_BEFORE')
    fireEvent.click(screen.getByRole('button', { name: 'Use local context for this request' }))
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection + local context')

    fireEvent.change(screen.getByRole('combobox', { name: 'Scope to show' }), { target: { value: 'section' } })
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection only')
    expect(screen.queryByText('EC03_LOCAL_BEFORE')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use local context for this request' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    expect(await screen.findByText('EC03_SECTION_TEXT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use section context for this request' })).toBeEnabled()
  })

  it('revokes preview and expanded authorization when snapshot identity changes', async () => {
    const latest = freeze({
      ...selection,
      id: 'ec03-s2',
      revision: 3,
      selection: { text: 'EC03 new selected text' },
      document: { title: 'EC03 new fixture page' },
    })
    api.getCurrentSelection.mockResolvedValueOnce(selection).mockResolvedValueOnce(latest)

    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    await screen.findByText('EC03_LOCAL_BEFORE')
    fireEvent.click(screen.getByRole('button', { name: 'Use local context for this request' }))
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection + local context')

    await waitFor(() => expect(eventApi.selectionHandler).not.toBeNull())
    eventApi.selectionHandler?.({ payload: { snapshotId: 'ec03-s2', revision: 3 } })

    expect(await screen.findByText('EC03 new selected text')).toBeInTheDocument()
    expect(screen.getByTestId('request-context-authorization')).toHaveTextContent('Selection only')
    expect(screen.queryByText('EC03_LOCAL_BEFORE')).not.toBeInTheDocument()
  })
})
