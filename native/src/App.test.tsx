import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const bridgeMocks = vi.hoisted(() => ({
  getBridgeStatus: vi.fn(),
  connectBridge: vi.fn(),
  pingBridge: vi.fn(),
  disconnectBridge: vi.fn(),
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

describe('Task 4 native companion shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMocks.getBridgeStatus.mockResolvedValue(disconnected)
    bridgeMocks.connectBridge.mockResolvedValue(connected)
    bridgeMocks.pingBridge.mockResolvedValue({ ...connected, lastLatencyMs: 7 })
    bridgeMocks.disconnectBridge.mockResolvedValue(disconnected)
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
})
