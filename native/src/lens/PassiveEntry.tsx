import { useEffect, useRef, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCaptureStatus, getCurrentSelection, type CaptureStatus } from '../api/bridge'
import type { SelectionSnapshot } from '../../../src/context/snapshot.js'
import { positionCurrentWindowNearSelection } from './windowPlacement'

interface SelectionCapturedEvent {
  readonly snapshotId: string
  readonly revision: number
  readonly readyAtMs?: number
}

interface LensOpenRequest extends SelectionCapturedEvent {}

interface EntryBinding extends LensOpenRequest {}

function validSelectionEvent(value: unknown): value is SelectionCapturedEvent {
  if (value === null || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  return typeof event.snapshotId === 'string'
    && event.snapshotId.length > 0
    && Number.isSafeInteger(event.revision)
    && (event.revision as number) >= 0
}

function sameBinding(left: EntryBinding | null, right: EntryBinding): boolean {
  return left?.snapshotId === right.snapshotId && left.revision === right.revision
}

async function updateEntryPosition(snapshot: SelectionSnapshot): Promise<void> {
  await positionCurrentWindowNearSelection(snapshot.geometry, { width: 44, height: 44 })
}

export default function PassiveEntry() {
  const [binding, setBinding] = useState<EntryBinding | null>(null)
  const [opening, setOpening] = useState(false)
  const latest = useRef<EntryBinding | null>(null)

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    const register = async <T,>(name: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(name, event => handler(event.payload))
      if (disposed) unlisten()
      else unlisteners.push(unlisten)
    }

    const presentSelection = (event: SelectionCapturedEvent) => {
      if (!validSelectionEvent(event)) return
      const readyAtMs = typeof event.readyAtMs === 'number' && Number.isSafeInteger(event.readyAtMs)
        ? event.readyAtMs
        : Date.now()
      const nextBinding = { snapshotId: event.snapshotId, revision: event.revision }
      if (sameBinding(latest.current, nextBinding)) return
      latest.current = nextBinding
      setBinding(null)
      void getCurrentWindow().hide()
      void Promise.all([getCurrentSelection(), getCaptureStatus()]).then(async ([snapshot, capture]) => {
        if (disposed || !sameBinding(latest.current, nextBinding)) return
        if (capture.paused) return
        if (snapshot === null || snapshot.id !== nextBinding.snapshotId || snapshot.revision !== nextBinding.revision) return
        await updateEntryPosition(snapshot)
        if (disposed || !sameBinding(latest.current, nextBinding)) return
        setBinding(nextBinding)
        await getCurrentWindow().show()
        await new Promise<void>(resolve => window.setTimeout(resolve, 0))
        if (disposed || !sameBinding(latest.current, nextBinding)) return
        await emitTo('main', 'lens-performance-sample', {
          kind: 'passiveEntryVisible',
          durationMs: Math.max(0, Date.now() - readyAtMs),
        })
      }).catch(() => undefined)
    }

    void register<SelectionCapturedEvent>('selection-captured', presentSelection).then(async () => {
      if (disposed || latest.current !== null) return
      const [snapshot, capture] = await Promise.all([getCurrentSelection(), getCaptureStatus()])
      if (disposed || latest.current !== null || capture.paused || snapshot === null) return
      presentSelection({ snapshotId: snapshot.id, revision: snapshot.revision })
    }).catch(() => undefined)

    void register<CaptureStatus>('capture-state-changed', status => {
      if (!status.paused) return
      latest.current = null
      setBinding(null)
      void getCurrentWindow().hide()
    }).catch(() => undefined)

    return () => {
      disposed = true
      for (const unlisten of unlisteners) unlisten()
    }
  }, [])

  const openLens = async () => {
    if (binding === null || opening) return
    setOpening(true)
    try {
      await emitTo('main', 'lens-open-request', { ...binding, requestedAtMs: Date.now() })
    } catch {
      // The passive entry stays available if the main window cannot be opened.
    } finally {
      setOpening(false)
    }
  }

  return <main className="passive-entry-root" data-testid="passive-entry">
    {binding !== null ? <button
      className="passive-entry-button"
      type="button"
      aria-label="Open selection Lens"
      title="Open selection Lens"
      disabled={opening}
      onClick={() => void openLens()}
    >✦</button> : null}
  </main>
}
