import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const api = vi.hoisted(() => ({ getCaptureStatus: vi.fn(), getCurrentSelection: vi.fn(), pauseCapture: vi.fn(), resumeCapture: vi.fn() }))
const hide = vi.hoisted(() => vi.fn())
vi.mock('./api/bridge', () => api)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide }) }))
const capture = { paused: false, phase: 'running', queueDepth: 0, lastTransitionAt: 1, lastError: null, metrics: { captured: 1, published: 1, deduplicated: 0, pausedDrops: 0, coalesced: 0, noSelection: 0, notApplicable: 0, excluded: 0, errors: 0, lastCaptureLatencyMs: 1 } }
const selection = { id: 's1', revision: 2, capturedAt: 1, selection: { text: '中文 selection 🚀' }, source: { kind: 'browser', app: 'Chrome' }, document: { title: 'Fixture page' }, context: { pageAvailable: false }, capabilities: { localContext: false, sectionContext: false, pageContext: false, screenshot: false }, provider: 'browser-accessibility', confidence: .5 }

describe('selection lens', () => {
  beforeEach(() => { vi.clearAllMocks(); api.getCaptureStatus.mockResolvedValue(capture); api.getCurrentSelection.mockResolvedValue(selection); api.pauseCapture.mockResolvedValue({ ...capture, paused: true, phase: 'paused' }); api.resumeCapture.mockResolvedValue(capture) })
  it('fixes and previews the selected material', async () => { render(<App />); expect(await screen.findByText('中文 selection 🚀')).toBeInTheDocument(); expect(screen.getByText('Fixed material · revision 2')).toBeInTheDocument() })
  it('does not submit while composing Chinese input and submits Enter after composition', async () => { render(<App />); const input = await screen.findByLabelText('Ask about this selection'); fireEvent.change(input, { target: { value: '问题' } }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true }); expect(screen.queryByText(/No model request/)).toBeNull(); fireEvent.keyDown(input, { key: 'Enter', isComposing: false }); expect(await screen.findByText(/No model request/)).toBeInTheDocument() })
  it('hides on Escape and keeps pause separate from Lens close', async () => { render(<App />); await screen.findByText('Fixture page'); fireEvent.keyDown(window, { key: 'Escape' }); expect(hide).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Pause capture' })); await waitFor(() => expect(api.pauseCapture).toHaveBeenCalledTimes(1)) })
})
