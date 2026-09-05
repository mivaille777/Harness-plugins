import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const bridgeMocks = vi.hoisted(() => ({
  getBridgeStatus: vi.fn(),
  getCaptureStatus: vi.fn(),
  connectBridge: vi.fn(),
  pingBridge: vi.fn(),
  disconnectBridge: vi.fn(),
  pauseCapture: vi.fn(),
  resumeCapture: vi.fn(),
}))

const hide = vi.hoisted(() => vi.fn())

vi.mock('./api/bridge', () => bridgeMocks)
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ hide }),
}))

const disconnected = {
  connected: false,
  endpoint: String.raw`\\.\pipe\dsh-selection-companion-v1`,
  protocol: 1,
  serverVersion: null,
  lastError: null,
  lastLatencyMs: null,
}

const connected = {
  ...disconnected,
  connected: true,
  serverVersion: '0.1.0',
}

const captureRunning = {
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
    lastCaptureLatencyMs: 4,
  },
}

describe('Task 4 native companion shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMocks.getBridgeStatus.mockResolvedValue(disconnected)
    bridgeMocks.getCaptureStatus.mockResolvedValue(captureRunning)
    bridgeMocks.connectBridge.mockResolvedValue(connected)
    bridgeMocks.pingBridge.mockResolvedValue({ ...connected, lastLatencyMs: 7 })
    bridgeMocks.disconnectBridge.mockResolvedValue(disconnected)
    bridgeMocks.pauseCapture.mockResolvedValue({ ...captureRunning, paused: true, phase: 'paused' })
    bridgeMocks.resumeCapture.mockResolvedValue(captureRunning)
  })

  it('auto-connects and renders the Harness bridge state', async () => {
    render(<App />)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
    expect(bridgeMocks.connectBridge).toHaveBeenCalledTimes(1)
  })

  it('pings the existing bridge and shows measured latency', async () => {
    render(<App />)
    await screen.findByText('Connected')

    fireEvent.click(screen.getByRole('button', { name: 'Ping' }))
    await waitFor(() => expect(bridgeMocks.pingBridge).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('7 ms')).toBeInTheDocument()
  })

  it('hides the overlay when Escape is pressed', async () => {
    render(<App />)
    await screen.findByText('Connected')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('pauses capture independently from the Harness bridge connection', async () => {
    render(<App />)
    await screen.findByText('Connected')

    fireEvent.click(screen.getByRole('button', { name: 'Pause capture' }))
    await waitFor(() => expect(bridgeMocks.pauseCapture).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Paused')).toBeInTheDocument()
    expect(bridgeMocks.disconnectBridge).not.toHaveBeenCalled()
  })
})
