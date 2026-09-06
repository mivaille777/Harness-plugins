import { useCallback, useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCaptureStatus, getCurrentSelection, pauseCapture, resumeCapture, type CaptureStatus } from './api/bridge'
import type { SelectionSnapshot } from '../../src/context/snapshot.js'

const emptyCapture: CaptureStatus = { paused: false, phase: 'running', queueDepth: 0, lastTransitionAt: 0, lastError: null, metrics: { captured: 0, published: 0, deduplicated: 0, pausedDrops: 0, coalesced: 0, noSelection: 0, notApplicable: 0, excluded: 0, errors: 0, lastCaptureLatencyMs: null } }
type Action = 'explain' | 'translate' | 'ask' | null

export default function App() {
  const [capture, setCapture] = useState<CaptureStatus>(emptyCapture)
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const [nextCapture, nextSnapshot] = await Promise.all([getCaptureStatus(), getCurrentSelection()])
    setCapture(nextCapture); setSnapshot(nextSnapshot)
  }, [])
  useEffect(() => { void refresh().catch(error => setNotice(String(error))) }, [refresh])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void getCurrentWindow().hide() } }
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close)
  }, [])
  const submit = (next: Exclude<Action, null>) => {
    if (next === 'ask' && draft.trim().length === 0) return
    setAction(next); setNotice('Session integration is not available yet. No model request was sent.')
  }
  const source = snapshot?.document?.title ?? snapshot?.source.windowTitle ?? snapshot?.source.app ?? 'Current selection'
  return <main className="lens" data-testid="selection-lens">
    <header className="lens-header" data-tauri-drag-region><span className="brand" data-tauri-drag-region>DeepSeek</span><button className="icon-button" type="button" onClick={() => void getCurrentWindow().hide()} aria-label="Close selection companion">×</button></header>
    {snapshot === null ? <section className="empty-state" aria-live="polite"><h1>Select text to begin</h1><p>Select non-sensitive browser text, then refresh it here.</p><button type="button" onClick={() => void refresh()}>Refresh selection</button></section> : <>
      <section className="material" aria-label="Fixed source material"><p className="source">{source}</p><blockquote>{snapshot.selection.text}</blockquote><p className="material-note">Fixed material · revision {snapshot.revision}</p></section>
      <div className="quick-actions"><button type="button" onClick={() => submit('explain')}>Explain</button><button type="button" className="secondary" onClick={() => submit('translate')}>Translate</button></div>
      <label className="question-label" htmlFor="question">Ask about this selection</label><textarea id="question" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit('ask') } }} placeholder="Ask a follow-up question" rows={3} />
      <div className="composer-actions"><button type="button" onClick={() => submit('ask')} disabled={draft.trim().length === 0}>Ask</button><button type="button" className="secondary" onClick={() => void refresh()}>Use latest selection</button></div>
    </>}
    {notice ? <p className="notice" role="status">{notice}</p> : null}
    <footer><button type="button" className="text-button" onClick={() => void (capture.paused ? resumeCapture() : pauseCapture()).then(setCapture)}>{capture.paused ? 'Resume capture' : 'Pause capture'}</button><span>{action === null ? 'No request active' : 'Development preview'}</span></footer>
  </main>
}
