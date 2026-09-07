import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const api = vi.hoisted(() => ({ getCaptureStatus: vi.fn(), getCurrentSelection: vi.fn(), pauseCapture: vi.fn(), resumeCapture: vi.fn(), submitSessionPrompt: vi.fn(), subscribeSession: vi.fn(), cancelSession: vi.fn() }))
const hide = vi.hoisted(() => vi.fn())
const eventApi = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  listen: vi.fn(),
  unlisten: vi.fn(),
}))
vi.mock('./api/bridge', () => api)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide }) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: eventApi.listen }))
const capture = { paused: false, phase: 'running', queueDepth: 0, lastTransitionAt: 1, lastError: null, metrics: { captured: 1, published: 1, deduplicated: 0, pausedDrops: 0, coalesced: 0, noSelection: 0, notApplicable: 0, excluded: 0, errors: 0, lastCaptureLatencyMs: 1 } }
const selection = { id: 's1', revision: 2, capturedAt: 1, selection: { text: '中文 selection 🚀' }, source: { kind: 'browser', app: 'Chrome' }, document: { title: 'Fixture page' }, context: { pageAvailable: false }, capabilities: { localContext: false, sectionContext: false, pageContext: false, screenshot: false }, provider: 'browser-accessibility', confidence: .5 }

describe('selection lens', () => {
  beforeEach(() => { vi.clearAllMocks(); eventApi.handler = null; eventApi.listen.mockImplementation(async (_name: string, handler: (event: { payload: unknown }) => void) => { eventApi.handler = handler; return eventApi.unlisten }); api.getCaptureStatus.mockResolvedValue(capture); api.getCurrentSelection.mockResolvedValue(selection); api.pauseCapture.mockResolvedValue({ ...capture, paused: true, phase: 'paused' }); api.resumeCapture.mockResolvedValue(capture); api.submitSessionPrompt.mockResolvedValue({ sessionId: 'session-1', requestId: 'request-1' }); api.subscribeSession.mockResolvedValue(undefined); api.cancelSession.mockResolvedValue(true) })
  it('fixes and previews the selected material', async () => { render(<App />); expect(await screen.findByText('中文 selection 🚀')).toBeInTheDocument(); expect(screen.getByText('Fixed material · revision 2')).toBeInTheDocument() })
  it('does not submit while composing Chinese input and subscribes after composition completes', async () => { render(<App />); const input = await screen.findByLabelText('Ask about this selection'); fireEvent.change(input, { target: { value: '问题' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(api.submitSessionPrompt).not.toHaveBeenCalled(); fireEvent.keyDown(input, { key: 'Enter', isComposing: false }); await waitFor(() => expect(api.submitSessionPrompt).toHaveBeenCalledTimes(1)); await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledWith('session-1', expect.any(String), undefined)); expect(await screen.findByText(/Waiting for Harness session session-1/)).toBeInTheDocument() })
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

    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    await waitFor(() => expect(api.subscribeSession).toHaveBeenCalledTimes(2))
    expect(api.subscribeSession.mock.calls[1]).toEqual(['session-1', expect.any(String), 3])
    const secondSubscription = api.subscribeSession.mock.calls[1]?.[1]
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId: firstSubscription, requestId: 'request-1', event: { kind: 'assistant-delta', data: { cursor: 4, persistent: true, value: { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'stale' } } } } } })
    expect(screen.queryByText('stale')).not.toBeInTheDocument()
    eventApi.handler?.({ payload: { sessionId: 'session-1', subscriptionId: secondSubscription, requestId: 'request-2', event: { kind: 'assistant-delta', data: { cursor: 4, persistent: true, value: { turn: 2, step: 1, value: { type: 'text-delta', index: 0, text: 'second' } } } } } })
    expect(await screen.findByText('second')).toBeInTheDocument()
  })
})
