import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  connectBridge,
  disconnectBridge,
  getCaptureStatus,
  getBridgeStatus,
  pauseCapture,
  pingBridge,
  resumeCapture,
  type CaptureStatus,
  type BridgeStatus,
} from './api/bridge'

const EMPTY_STATUS: BridgeStatus = {
  connected: false,
  endpoint: String.raw`\\.\pipe\dsh-selection-companion-v1`,
  protocol: 1,
  serverVersion: null,
  lastError: null,
  lastLatencyMs: null,
}

const EMPTY_CAPTURE_STATUS: CaptureStatus = {
  paused: false,
  phase: 'running',
  queueDepth: 0,
  lastTransitionAt: 0,
  lastError: null,
  metrics: {
    captured: 0,
    published: 0,
    deduplicated: 0,
    pausedDrops: 0,
    coalesced: 0,
    noSelection: 0,
    notApplicable: 0,
    excluded: 0,
    errors: 0,
    lastCaptureLatencyMs: null,
  },
}

export default function App() {
  const [status, setStatus] = useState<BridgeStatus>(EMPTY_STATUS)
  const [capture, setCapture] = useState<CaptureStatus>(EMPTY_CAPTURE_STATUS)
  const [busy, setBusy] = useState<'connect' | 'ping' | 'disconnect' | 'capture' | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)

  const run = useCallback(async (
    kind: 'connect' | 'ping' | 'disconnect',
    action: () => Promise<BridgeStatus>,
  ) => {
    setBusy(kind)
    setUiError(null)
    try {
      setStatus(await action())
    } catch (error) {
      setUiError(error instanceof Error ? error.message : String(error))
      try {
        setStatus(await getBridgeStatus())
      } catch {
        // Keep the last known status when the shell itself is unavailable.
      }
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const captureStatus = await getCaptureStatus()
        if (!cancelled) setCapture(captureStatus)
        const current = await getBridgeStatus()
        if (!cancelled) setStatus(current)
        if (!current.connected && !cancelled) {
          await run('connect', connectBridge)
        }
      } catch (error) {
        if (!cancelled) setUiError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => { cancelled = true }
  }, [run])

  const toggleCapture = useCallback(async () => {
    setBusy('capture')
    setUiError(null)
    try {
      setCapture(await (capture.paused ? resumeCapture() : pauseCapture()))
    } catch (error) {
      setUiError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }, [capture.paused])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void getCurrentWindow().hide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const effectiveError = uiError ?? status.lastError ?? capture.lastError

  return (
    <main className="shell" data-testid="companion-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <div className="eyebrow">DeepSeek Harness</div>
          <h1>Selection Companion</h1>
        </div>
        <span className={`status-dot ${status.connected ? 'connected' : 'disconnected'}`} aria-hidden="true" />
      </header>

      <section className="status-card" aria-live="polite">
        <div className="status-row">
          <span>Status</span>
          <strong>{status.connected ? 'Connected' : 'Disconnected'}</strong>
        </div>
        <div className="status-row endpoint-row">
          <span>Pipe</span>
          <code title={status.endpoint}>{status.endpoint}</code>
        </div>
        <div className="status-row">
          <span>Protocol</span>
          <strong>v{status.protocol}</strong>
        </div>
        <div className="status-row">
          <span>Harness plugin</span>
          <strong>{status.serverVersion ?? '—'}</strong>
        </div>
        <div className="status-row">
          <span>Last ping</span>
          <strong>{status.lastLatencyMs === null ? '—' : `${status.lastLatencyMs} ms`}</strong>
        </div>
      </section>

      {effectiveError ? <p className="error" role="alert">{effectiveError}</p> : null}

      <section className="status-card" aria-live="polite">
        <div className="status-row">
          <span>Capture</span>
          <strong>{capture.paused ? 'Paused' : capture.phase}</strong>
        </div>
        <div className="status-row">
          <span>Queue</span>
          <strong>{capture.queueDepth} / 1</strong>
        </div>
        <div className="status-row">
          <span>Published</span>
          <strong>{capture.metrics.published}</strong>
        </div>
      </section>

      <div className="actions">
        <button
          type="button"
          onClick={() => { void run('connect', connectBridge) }}
          disabled={busy !== null || status.connected}
        >
          {busy === 'connect' ? 'Connecting…' : 'Connect'}
        </button>
        <button
          type="button"
          onClick={() => { void run('ping', pingBridge) }}
          disabled={busy !== null || !status.connected}
        >
          {busy === 'ping' ? 'Pinging…' : 'Ping'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => { void run('disconnect', disconnectBridge) }}
          disabled={busy !== null || !status.connected}
        >
          Disconnect
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => { void toggleCapture() }}
          disabled={busy !== null}
        >
          {busy === 'capture' ? 'Updating…' : capture.paused ? 'Resume capture' : 'Pause capture'}
        </button>
      </div>

      <footer>Task 2 · extensionless browser accessibility capture enabled</footer>
    </main>
  )
}
