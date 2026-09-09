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
const hide = vi.hoisted(() => vi.fn())
const eventApi = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  listen: vi.fn(),
  unlisten: vi.fn(),
}))
vi.mock('./api/bridge', () => api)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: eventApi.listen }))
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  for (const child of Object.values(value)) deepFreeze(child)
  Object.freeze(value)
  return value
}
const capture = { paused: false, phase: 'running', queueDepth: 0, lastTransitionAt: 1, lastError: null, metrics: { captured: 1, published: 1, deduplicated: 0, pausedDrops: 0, coalesced: 0, noSelection: 0, notApplicable: 0, excluded: 0, errors: 0, lastCaptureLatencyMs: 1 } }
const selection = deepFreeze({ id: 's1', revision: 2, capturedAt: 1, selection: { text: '中文 selection 🚀' }, source: { kind: 'browser', app: 'Chrome' }, document: { title: 'Fixture page' }, context: { before: 'Before context', after: 'After context', sectionText: 'Section context', pageAvailable: false }, capabilities: { localContext: true, sectionContext: true, pageContext: false, screenshot: false }, provider: 'browser-accessibility', confidence: .5 })

describe('selection lens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    eventApi.handler = null
    eventApi.listen.mockImplementation(async (_name: string, handler: (event: { payload: unknown }) => void) => { eventApi.handler = handler; return eventApi.unlisten })
    api.getCaptureStatus.mockResolvedValue(capture)
    api.getCurrentSelection.mockResolvedValue(selection)
    api.listSessions.mockResolvedValue([])
    api.createSession.mockResolvedValue('session-new')
    api.expandSelection.mockResolvedValue({ snapshotId: 's1', scope: 'local', revision: 2, completeness: 'complete', truncated: false, context: { before: 'Loaded before', after: 'Loaded after' } })
    api.readSessionHistory.mockResolvedValue({ sessionId: 'session-1', capturedThroughCursor: 0, entries: [] })
    api.pauseCapture.mockResolvedValue({ ...capture, paused: true, phase: 'paused' })
    api.resumeCapture.mockResolvedValue(capture)
    api.submitSessionPrompt.mockResolvedValue({ sessionId: 'session-1', requestId: 'request-1' })
    api.subscribeSession.mockResolvedValue(undefined)
    api.unsubscribeSession.mockResolvedValue({ sessionId: 'session-1', subscriptionId: 'subscription', released: true })
    api.cancelSession.mockResolvedValue(true)
  })
  it('fixes and previews the selected material', async () => { render(<App />); expect(await screen.findByText('中文 selection 🚀')).toBeInTheDocument(); expect(screen.getByText('Fixed material · revision 2')).toBeInTheDocument() })
  it('keeps captured context behind an explicit disclosure', async () => {
    render(<App />)
    const panel = await screen.findByTestId('captured-context')
    expect(panel).not.toHaveAttribute('open')
    expect(screen.getByText('Only context already captured with this selection is shown. The current request sends the fixed selection; this preview is not added automatically.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Captured context'))
    expect(panel).toHaveAttribute('open')
    expect(screen.getByText('Before context')).toBeInTheDocument()
    expect(screen.getByText('After context')).toBeInTheDocument()
    expect(screen.getAllByText('Section context')).toHaveLength(2)
  })
  it('loads a selected context scope only after the user requests it', async () => {
    render(<App />)
    fireEvent.click(await screen.findByText('Captured context'))
    fireEvent.click(screen.getByRole('button', { name: 'Load context' }))
    await waitFor(() => expect(api.expandSelection).toHaveBeenCalledWith('s1', 'local'))
    expect(await screen.findByText('Context loaded completely')).toBeInTheDocument()
    expect(screen.getByText('Loaded before')).toBeInTheDocument()
  })
  it('keeps the primary Lens controls labelled and keyboard discoverable', async () => {
    render(<App />)
    const main = await screen.findByTestId('selection-lens')
    expect(main).toHaveAttribute('lang', 'en-US')
    expect(screen.getByRole('combobox', { name: 'Harness session' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close selection companion' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeEnabled()
    expect(screen.getByLabelText('Ask about this selection')).toHaveAttribute('placeholder', 'Ask a follow-up question')
    expect(screen.getByRole('combobox', { name: 'Scope to show' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load context' })).toBeEnabled()
    expect(screen.getByText('No request active')).toHaveAttribute('aria-live', 'polite')
  })
  it('keeps product actions focused on perception support without a translation action', async () => {
    render(<App />)
    await screen.findByTestId('selection-lens')
    expect(screen.queryByRole('button', { name: /translate|翻译/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/translation|翻译/i)).not.toBeInTheDocument()
  })
  it('restores the remembered session and renders paged durable history before subscribing', async () => {
    window.localStorage.setItem('dsh-selection-companion.session', 'session-2')
    api.listSessions.mockResolvedValueOnce([
      { id: 'session-1', title: 'First session', status: 'idle', createdAt: 1, live: false, persisted: true },
      { id: 'session-2', title: 'Remembered session', status: 'running', createdAt: 2, live: true, persisted: true },
    ])
    api.readSessionHistory.mockImplementation(async (id: string, afterCursor?: number) => afterCursor === 0
      ? { sessionId: id, nextCursor: 3, capturedThroughCursor: 6, entries: [{ seq: 2, time: 2, role: 'user', text: 'Earlier question' }] }
      : { sessionId: id, capturedThroughCursor: 6, entries: [{ seq: 4, time: 4, role: 'assistant', text: 'Earlier answer' }] })
    render(<App />)
    expect(await screen.findByTestId('history-entry-2')).toHaveTextContent('Earlier question')
    expect(await screen.findByTestId('history-entry-4')).toHaveTextContent('Earlier answer')
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledWith('session-2', expect.any(String), 6))
  })
  it('keeps a history restore failure visible without creating a replacement session', async () => {
    api.listSessions.mockResolvedValueOnce([{ id: 'session-missing', title: 'Unavailable session', status: 'unknown', persisted: false }])
    api.readSessionHistory.mockRejectedValueOnce(new Error('durable log unavailable'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('durable log unavailable')
    expect(api.createSession).not.toHaveBeenCalled()
    expect(api.subscribeSession).not.toHaveBeenCalled()
  })
  it('releases the old session and restores its own draft when switching', async () => {
    api.listSessions.mockResolvedValueOnce([
      { id: 'session-1', title: 'First session', status: 'idle', createdAt: 1, live: true, persisted: true },
      { id: 'session-2', title: 'Second session', status: 'idle', createdAt: 2, live: true, persisted: true },
    ])
    api.readSessionHistory.mockImplementation(async (id: string) => ({ sessionId: id, capturedThroughCursor: 0, entries: [] }))
    render(<App />)
    const input = await screen.findByLabelText('Ask about this selection')
    fireEvent.change(input, { target: { value: 'draft for first session' } })
    const selector = await screen.findByRole('combobox', { name: 'Harness session' })
    fireEvent.change(selector, { target: { value: 'session-2' } })
    await waitFor(() => expect(api.unsubscribeSession).toHaveBeenCalledWith('session-1', expect.any(String)))
    expect((await screen.findByLabelText('Ask about this selection') as HTMLTextAreaElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('Ask about this selection'), { target: { value: 'draft for second session' } })
    fireEvent.change(selector, { target: { value: 'session-1' } })
    await waitFor(() => expect(api.unsubscribeSession).toHaveBeenCalledTimes(2))
    expect((await screen.findByLabelText('Ask about this selection') as HTMLTextAreaElement).value).toBe('draft for first session')
  })
  it('does not submit while composing Chinese input and subscribes after composition completes', async () => { render(<App />); const input = await screen.findByLabelText('Ask about this selection'); fireEvent.change(input, { target: { value: '问题' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(api.submitSessionPrompt).not.toHaveBeenCalled(); fireEvent.keyDown(input, { key: 'Enter', isComposing: false }); await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1)); await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledWith('session-1', expect.any(String), 0)); expect(await screen.findByText(/Waiting for Harness session session-1/)).toBeInTheDocument() })
  it('hides on Escape and keeps pause separate from Lens close', async () => { render(<App />); await screen.findByText('Fixture page'); fireEvent.keyDown(window, { key: 'Escape' }); expect(hide).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Pause capture' })); await waitFor(() => expect(api.pauseCapture).toHaveBeenCalledTimes(1)) })
  it('renders correlated text and completes only on turn end', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalled())
    const subscriptionId = api.subscribeSession.mock.calls[0]?.[1]
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId, requestId: 'request-1', event: { kind: 'assistant-delta', data: { cursor: 3, persistent: true, value: { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'Actual answer' } } } } } })
    expect(await screen.findByText('Actual answer')).toBeInTheDocument()
    expect(screen.getByText('Receiving answer')).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for Harness session/)).not.toBeInTheDocument()
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId, requestId: 'request-1', event: { kind: 'assistant-complete', data: { cursor: 4, persistent: true, value: { turn: 1, step: 1, value: { content: [{ type: 'text', text: 'Actual answer' }] } } } } } })
    expect(screen.getByText('Receiving answer')).toBeInTheDocument()
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId, requestId: 'request-1', event: { kind: 'status', data: { cursor: 5, persistent: true, value: { status: 'turn-end', turn: 1, reason: { kind: 'completed' } } } } } })
    expect(await screen.findByText('Answer complete')).toBeInTheDocument()
  })
  it('requests cancellation and waits for the correlated aborted turn end', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    await screen.findByText('Waiting for Harness')
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }))
    await waitFor(() => expect(api.cancelSession).toHaveBeenCalledWith('session-1'))
    expect(await screen.findByText('Stopping session')).toBeInTheDocument()
    expect(screen.queryByText('Session stopped')).not.toBeInTheDocument()
    const subscriptionId = api.subscribeSession.mock.calls[0]?.[1]
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId, requestId: 'request-1', event: { kind: 'status', data: { cursor: 6, persistent: true, value: { status: 'turn-end', turn: 1, reason: { kind: 'aborted', cause: { kind: 'user' } } } } } } })
    expect(await screen.findByText('Session stopped')).toBeInTheDocument()
    expect(screen.queryByText(/Harness is stopping/)).not.toBeInTheDocument()
  })
  it('waits for listener registration before subscribing and cleans up a late registration', async () => {
    let resolveListen: ((unlisten: () => void) => void) | undefined
    eventApi.listen.mockImplementation(() => new Promise(resolve => { resolveListen = resolve }))
    const view = render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalled())
    expect(api.subscribeSession).not.toHaveBeenCalled()
    view.unmount()
    resolveListen?.(eventApi.unlisten)
    await waitFor(() => expect(eventApi.unlisten).toHaveBeenCalledTimes(1))
    expect(api.subscribeSession).not.toHaveBeenCalled()
  })
  it('resubscribes from the last accepted durable cursor and ignores the replaced generation', async () => {
    api.submitSessionPrompt
      .mockResolvedValueOnce({ sessionId: 'session-1', requestId: 'request-1' })
      .mockResolvedValueOnce({ sessionId: 'session-1', requestId: 'request-2' })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(1))
    const firstSubscription = api.subscribeSession.mock.calls[0]?.[1]
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId: firstSubscription, requestId: 'request-1', event: { kind: 'assistant-delta', data: { cursor: 3, persistent: true, value: { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'first' } } } } } })
    expect(await screen.findByText('first')).toBeInTheDocument()
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId: firstSubscription, requestId: 'request-1', event: { kind: 'status', data: { cursor: 4, persistent: true, value: { status: 'turn-end', turn: 1, reason: { kind: 'completed' } } } } } })
    expect(await screen.findByText('Answer complete')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(2))
    expect(api.subscribeSession.mock.calls[1]).toEqual(['session-1', expect.any(String), 4])
    expect(api.submitSessionPrompt.mock.calls[0]?.[2]).not.toBe(api.submitSessionPrompt.mock.calls[1]?.[2])
    const secondSubscription = api.subscribeSession.mock.calls[1]?.[1]
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId: firstSubscription, requestId: 'request-1', event: { kind: 'assistant-delta', data: { cursor: 5, persistent: true, value: { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'stale' } } } } } })
    expect(screen.queryByText('stale')).not.toBeInTheDocument()
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId: secondSubscription, requestId: 'request-2', event: { kind: 'assistant-delta', data: { cursor: 5, persistent: true, value: { turn: 2, step: 1, value: { type: 'text-delta', index: 0, text: 'second' } } } } } })
    expect(await screen.findByText('second')).toBeInTheDocument()
  })
  it('locks duplicate actions before the first submission settles', async () => {
    let finishSubmit: ((value: { sessionId: string; requestId: string }) => void) | undefined
    api.submitSessionPrompt.mockImplementationOnce(() => new Promise(resolve => { finishSubmit = resolve }))
    render(<App />)
    const explain = await screen.findByRole('button', { name: 'Explain' })
    fireEvent.click(explain)
    fireEvent.click(explain)
    expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1)
    finishSubmit?.({ sessionId: 'session-1', requestId: 'request-1' })
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(1))
  })
  it('retries an unknown submission with the same logical request identity and fixed snapshot', async () => {
    api.submitSessionPrompt
      .mockRejectedValueOnce(new api.SubmissionUnknownError('session-recovered', 'request-recovered', 'reply lost'))
      .mockResolvedValueOnce({ sessionId: 'session-recovered', requestId: 'request-recovered', messageId: 'message-recovered', delivery: 'queued', duplicate: true })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    expect(await screen.findByText('Submission status unknown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Use latest selection' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry safely' }))
    await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(2))
    expect(api.submitSessionPrompt.mock.calls[1]?.[0]).toBe('session-recovered')
    expect(api.submitSessionPrompt.mock.calls[1]?.[2]).toBe('request-recovered')
    expect(api.submitSessionPrompt.mock.calls[0]?.[3]).toBe(selection)
    expect(api.submitSessionPrompt.mock.calls[1]?.[3]).toBe(api.submitSessionPrompt.mock.calls[0]?.[3])
    expect(Object.isFrozen(api.submitSessionPrompt.mock.calls[1]?.[3])).toBe(true)
    expect(api.submitSessionPrompt.mock.calls[1]?.[3]).toMatchObject({
      id: 's1',
      revision: 2,
      selection: { text: '中文 selection 🚀' },
      document: { title: 'Fixture page' },
    })
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(1))
  })
  it('keeps a completed turn when the cancellation reply arrives late', async () => {
    let finishCancel: ((cancelled: boolean) => void) | undefined
    api.cancelSession.mockImplementationOnce(() => new Promise(resolve => { finishCancel = resolve }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(1))
    const subscriptionId = api.subscribeSession.mock.calls[0]?.[1]
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }))
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId, requestId: 'request-1', event: { kind: 'status', data: { cursor: 5, persistent: true, value: { status: 'turn-end', turn: 1, reason: { kind: 'completed' } } } } } })
    expect(await screen.findByText('Answer complete')).toBeInTheDocument()
    finishCancel?.(false)
    await waitFor(() => expect(screen.queryByText('Request failed')).not.toBeInTheDocument())
    expect(screen.getByText('Answer complete')).toBeInTheDocument()
  })
  it('keeps a completed turn when cancellation rejects after completion', async () => {
    let rejectCancel: ((error: Error) => void) | undefined
    api.cancelSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCancel = reject }))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(1))
    const subscriptionId = api.subscribeSession.mock.calls[0]?.[1]
    fireEvent.click(screen.getByRole('button', { name: 'Stop session' }))
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId, requestId: 'request-1', event: { kind: 'status', data: { cursor: 5, persistent: true, value: { status: 'turn-end', turn: 1, reason: { kind: 'completed' } } } } } })
    expect(await screen.findByText('Answer complete')).toBeInTheDocument()
    rejectCancel?.(new Error('cancel reply lost'))
    await waitFor(() => expect(screen.queryByText('Error: cancel reply lost')).not.toBeInTheDocument())
    expect(screen.getByText('Answer complete')).toBeInTheDocument()
  })
})
