import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  cancelSession,
  beginInteractionGuard,
  createSession,
  expandSelection,
  endInteractionGuard,
  getCaptureStatus,
  getCurrentSelection,
  listSessions,
  pauseCapture,
  readSessionHistory,
  resumeCapture,
  restoreSourceFocus,
  submitSessionPrompt,
  subscribeSession,
  SubmissionUnknownError,
  unsubscribeSession,
  type CaptureStatus,
  type SessionAgentEvent,
  type SessionHistoryEntry,
  type SelectionExpansion,
  type SessionSubmission,
  type SessionSummary,
} from './api/bridge'
import {
  initialRequestProjection,
  mergeSessionHistory,
  projectSessionEvent,
  type RequestPhase,
  type RequestProjection,
} from './sessionProjection'
import type { SelectionSnapshot } from '../../src/context/snapshot.js'
import type { ContextScope } from '../../src/bridge/protocol.js'
import type { SelectionMaterial } from '../../src/session/material.js'
import { getAppCopy, type AppCopy } from './copy'
import {
  authorizeExpandedContext,
  defaultAuthorizedMaterial,
  isAuthorizationCurrent,
} from './contextAuthorization'
import {
  buildAuthorizedMaterialPrompt,
  renderAuthorizedMaterialReference,
} from './requestMaterial'
import {
  initialLensState,
  sameLensSelection,
  transitionLens,
  type LensBinding,
  type LensEvent,
} from './lens/store'
import {
  emptyLensPerformanceState,
  recordLensLatency,
  type LensLatencyMetric,
  type LensPerformanceState,
} from './lens/performance'
import { positionCurrentWindowNearSelection } from './lens/windowPlacement'
import DiagnosticsPage from './DiagnosticsPage'

const emptyCapture: CaptureStatus = {
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
    guardDrops: 0,
    focusDrops: 0,
    coalesced: 0,
    noSelection: 0,
    notApplicable: 0,
    excluded: 0,
    errors: 0,
    lastCaptureLatencyMs: null,
    eventCaptureLatencyP50Ms: null,
    eventCaptureLatencyP95Ms: null,
    fallbackCaptureLatencyP50Ms: null,
    fallbackCaptureLatencyP95Ms: null,
  },
}

type Action = 'explain' | 'ask' | null
const SELECTION_PREVIEW_LIMIT = 420

interface AppProps {
  readonly initiallyOpen?: boolean
}
type ExpandableContextScope = Exclude<ContextScope, 'selection'>

interface ActiveSession {
  readonly sessionId: string | null
  readonly requestId: string | null
  readonly subscriptionId: string | null
}

interface CompleteHistory {
  readonly entries: readonly SessionHistoryEntry[]
  readonly capturedThroughCursor: number
}

interface SelectionCapturedEvent {
  readonly snapshotId: string
  readonly revision: number
}

interface LensOpenRequestEvent extends SelectionCapturedEvent {
  readonly requestedAtMs?: number
}

const SESSION_PREFERENCE_KEY = 'dsh-selection-companion.session'
const COMPOSER_LIMIT = 2000

function rememberedSessionId(): string | null {
  try {
    const value = window.localStorage.getItem(SESSION_PREFERENCE_KEY)
    return value?.trim() || null
  } catch {
    return null
  }
}

function rememberSessionId(sessionId: string): void {
  try {
    window.localStorage.setItem(SESSION_PREFERENCE_KEY, sessionId)
  } catch {
    // A private or restricted WebView can deny storage without affecting the live session.
  }
}

async function readCompleteHistory(sessionId: string): Promise<CompleteHistory> {
  const entries: SessionHistoryEntry[] = []
  let afterCursor = 0
  let capturedThroughCursor = 0
  for (;;) {
    const page = await readSessionHistory(sessionId, afterCursor)
    entries.push(...page.entries)
    capturedThroughCursor = page.capturedThroughCursor
    if (page.nextCursor === undefined) return { entries, capturedThroughCursor }
    if (page.nextCursor <= afterCursor) throw new Error('Harness returned a history page without advancing its cursor.')
    afterCursor = page.nextCursor
  }
}

function bindingForSelection(snapshot: SelectionSnapshot): LensBinding {
  return { snapshotId: snapshot.id, revision: snapshot.revision, openedAt: Date.now() }
}

function textDeltaFromEvent(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const delta = (value as Record<string, unknown>).value
  if (delta === null || typeof delta !== 'object') return null
  const message = delta as Record<string, unknown>
  return message.type === 'text-delta' && typeof message.text === 'string' ? message.text : null
}

function streamOutcomeFromEvent(value: unknown): 'completed' | 'cancelled' | 'error' | null {
  if (value === null || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  if (root.status !== 'turn-end' || root.reason === null || typeof root.reason !== 'object') return null
  const reason = (root.reason as Record<string, unknown>).kind
  if (reason === 'completed' || reason === 'max-tokens') return 'completed'
  if (reason === 'aborted') return 'cancelled'
  return 'error'
}

function sessionLabel(session: SessionSummary, index: number, copy: AppCopy): string {
  return session.title?.trim() || `${copy.untitledSession} ${index + 1}`
}

function sessionStatusLabel(session: SessionSummary, copy: AppCopy): string {
  switch (session.status) {
    case 'running': return copy.sessionRunning
    case 'queued': return copy.sessionQueued
    case 'idle': return copy.sessionIdle
    default: return session.persisted === false ? copy.sessionUnavailable : copy.sessionReady
  }
}

export default function App({ initiallyOpen = true }: AppProps) {
  const copy = getAppCopy()
  const [capture, setCapture] = useState<CaptureStatus>(emptyCapture)
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
  const snapshotRef = useRef<SelectionSnapshot | null>(null)
  const [selectionExpanded, setSelectionExpanded] = useState(false)
  const [lensState, setLensState] = useState(initialLensState)
  const [contextScope, setContextScope] = useState<ExpandableContextScope>('local')
  const [expandedContext, setExpandedContext] = useState<SelectionExpansion | null>(null)
  const [authorizedMaterial, setAuthorizedMaterial] = useState<SelectionMaterial | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [history, setHistory] = useState<readonly SessionHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [projection, setProjection] = useState<RequestProjection>(initialRequestProjection)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [lensPerformance, setLensPerformance] = useState<LensPerformanceState>(emptyLensPerformanceState)
  const [lastEventSequence, setLastEventSequence] = useState<number | null>(null)
  const [subscriptionState, setSubscriptionState] = useState('idle')
  const busy = ['submitting', 'queued', 'streaming', 'cancelling', 'submission-unknown'].includes(projection.phase)
  const lensStateRef = useRef(initialLensState)
  const active = useRef<ActiveSession>({ sessionId: null, requestId: null, subscriptionId: null })
  const cursors = useRef(new Map<string, number>())
  const drafts = useRef(new Map<string, string>())
  const draftValue = useRef('')
  const sessionGeneration = useRef(0)
  const pendingSubmission = useRef<{
    sessionId: string | null
    requestId: string
    action: Exclude<Action, null>
    prompt: string
    material: SelectionSnapshot
    authorizedMaterial: SelectionMaterial
  } | null>(null)
  const listenerReady = useRef<Promise<void>>(Promise.resolve())
  const viewActive = useRef(true)
  const snapshotIdentityRef = useRef<string | null>(null)
  snapshotRef.current = snapshot

  const dispatchLensEvent = useCallback((event: LensEvent) => {
    const previous = lensStateRef.current
    const next = transitionLens(previous, event)
    if (next !== previous) {
      lensStateRef.current = next
      setLensState(next)
    }
    return next
  }, [])

  const recordLensPerformance = useCallback((metric: LensLatencyMetric, durationMs: number) => {
    setLensPerformance(previous => recordLensLatency(previous, metric, durationMs))
  }, [])

  const refresh = useCallback(async (useLatest = false, expectedBinding?: LensBinding): Promise<SelectionSnapshot | null> => {
    const stateAtStart = lensStateRef.current
    const latestAtStart = stateAtStart.latestSelection
    const hadPendingAtStart = stateAtStart.binding !== null
      && stateAtStart.latestSelection !== null
      && !sameLensSelection(stateAtStart.binding, stateAtStart.latestSelection)
    const [nextCapture, nextSnapshot] = await Promise.all([getCaptureStatus(), getCurrentSelection()])
    setCapture(nextCapture)
    if (nextSnapshot === null) {
      if (lensStateRef.current.binding === null) {
        setSnapshot(null)
        dispatchLensEvent({ type: 'source_invalidated' })
      } else if (useLatest) {
        setNotice(copy.latestSelectionChanged)
      }
      return null
    }

    const binding = bindingForSelection(nextSnapshot)
    if (expectedBinding !== undefined && !sameLensSelection(expectedBinding, binding)) {
      setNotice(copy.latestSelectionChanged)
      return null
    }
    const stateAfterRead = lensStateRef.current
    if (
      !sameLensSelection(stateAfterRead.latestSelection, latestAtStart)
      && !sameLensSelection(stateAfterRead.latestSelection, binding)
    ) {
      setNotice(copy.latestSelectionChanged)
      return null
    }
    if (useLatest && hadPendingAtStart && !sameLensSelection(latestAtStart, binding)) {
      setNotice(copy.latestSelectionChanged)
      return null
    }

    dispatchLensEvent({ type: 'selection_detected', binding })
    const current = lensStateRef.current
    let next = current
    if (current.binding === null) {
      next = dispatchLensEvent({ type: 'lens_open' })
    } else if (useLatest) {
      next = dispatchLensEvent({ type: 'use_latest_selection' })
    }

    if (sameLensSelection(next.binding, binding)) {
      setSnapshot(nextSnapshot)
      if (stateAtStart.binding !== null && !sameLensSelection(stateAtStart.binding, binding)) setNotice(copy.selectionUpdated)
      return nextSnapshot
    } else if (!sameLensSelection(current.binding, binding)) {
      setNotice(copy.selectionAvailable)
    }
    return null
  }, [copy.latestSelectionChanged, copy.selectionAvailable, copy.selectionUpdated, dispatchLensEvent])

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      setSessions(await listSessions())
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initiallyOpen) {
      void refresh().catch(error => setNotice(String(error)))
    } else {
      void getCaptureStatus().then(setCapture).catch(error => setNotice(String(error)))
    }
  }, [initiallyOpen, refresh])
  useEffect(() => {
    const currentWindow = getCurrentWindow()
    let disposed = false
    let focused = false
    let focusEvents = 0
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let transition = Promise.resolve()

    const enqueue = (operation: () => Promise<unknown>) => {
      transition = transition.then(async () => {
        try {
          await operation()
        } catch (error) {
          if (!disposed) setNotice(`Capture guard could not be updated: ${String(error)}`)
        }
      })
    }
    const engage = () => enqueue(() => beginInteractionGuard('lensInteraction', 'lens-main-window-focus'))
    const disengage = () => enqueue(() => endInteractionGuard('lensInteraction', 'lens-main-window-focus'))
    const updateFocus = (nextFocused: boolean) => {
      if (disposed || focused === nextFocused) return
      focused = nextFocused
      focusEvents += 1
      if (focused) {
        engage()
        heartbeat = setInterval(engage, 10_000)
      } else {
        if (heartbeat !== undefined) clearInterval(heartbeat)
        heartbeat = undefined
        disengage()
      }
    }

    let unlisten: (() => void) | undefined
    void currentWindow.onFocusChanged(event => updateFocus(event.payload)).then(dispose => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch(error => {
      if (!disposed) setNotice(`Lens focus tracking could not start: ${String(error)}`)
    })
    const initialFocusRevision = focusEvents
    void currentWindow.isFocused().then(value => {
      if (focusEvents === initialFocusRevision) updateFocus(value)
    }).catch(error => {
      if (!disposed) setNotice(`Lens focus state could not be read: ${String(error)}`)
    })

    return () => {
      disposed = true
      if (heartbeat !== undefined) clearInterval(heartbeat)
      unlisten?.()
      if (focused) {
        focused = false
        disengage()
      }
    }
  }, [])
  useEffect(() => {
    const identity = snapshot === null ? null : `${snapshot.id}:${snapshot.revision}`
    snapshotIdentityRef.current = identity
    setExpandedContext(null)
    setSelectionExpanded(false)
    setAuthorizedMaterial(snapshot === null ? null : defaultAuthorizedMaterial(snapshot))
    setContextError(null)
    if (snapshot?.capabilities.localContext) setContextScope('local')
    else if (snapshot?.capabilities.sectionContext) setContextScope('section')
    else if (snapshot?.capabilities.pageContext && snapshot.context.pageAvailable) setContextScope('page')
    else setContextScope('local')
  }, [snapshot?.id, snapshot?.revision])
  useEffect(() => { draftValue.current = draft }, [draft])
  useEffect(() => {
    void refreshSessions().catch(error => setNotice(`Unable to load Harness sessions: ${String(error)}`))
  }, [refreshSessions])
  useEffect(() => {
    let disposed = false
    let unlisten: () => void = () => undefined
    void listen<LensOpenRequestEvent>('lens-open-request', event => {
      if (disposed) return
      const { snapshotId, revision } = event.payload
      if (typeof snapshotId !== 'string' || !Number.isSafeInteger(revision) || revision < 0) return
      const requestedAtMs = typeof event.payload.requestedAtMs === 'number'
        && Number.isSafeInteger(event.payload.requestedAtMs)
        && event.payload.requestedAtMs > 0
        ? event.payload.requestedAtMs
        : Date.now()
      const expectedBinding: LensBinding = { snapshotId, revision, openedAt: Date.now() }
      const current = lensStateRef.current
      const requestIsActive = current.request.phase === 'submitting' || current.request.phase === 'streaming'
      const pinnedSnapshot = snapshotRef.current
      const reopenPinnedRequest = requestIsActive
        && current.binding !== null
        && pinnedSnapshot !== null
        && sameLensSelection(current.binding, bindingForSelection(pinnedSnapshot))
      if (reopenPinnedRequest) dispatchLensEvent({ type: 'lens_open' })
      const selectedPromise = reopenPinnedRequest
        ? Promise.resolve(pinnedSnapshot)
        : refresh(true, expectedBinding)
      void selectedPromise.then(async selected => {
        if (disposed || selected === null) return
        await positionCurrentWindowNearSelection(selected.geometry, { width: 420, height: 580 })
        if (disposed) return
        await getCurrentWindow().show()
        await getCurrentWindow().setFocus()
        recordLensPerformance('lensInteractive', Math.max(0, Date.now() - requestedAtMs))
      }).catch(error => {
        if (!disposed) setNotice(String(error))
      })
    }).then(dispose => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch(error => {
      if (!disposed) setNotice(String(error))
    })
    return () => {
      disposed = true
      unlisten()
    }
  }, [dispatchLensEvent, recordLensPerformance, refresh])

  useEffect(() => {
    let disposed = false
    let unlisten: () => void = () => undefined
    void listen<{ readonly kind: unknown; readonly durationMs: unknown }>('lens-performance-sample', event => {
      if (disposed || typeof event.payload.durationMs !== 'number') return
      if (event.payload.kind !== 'passiveEntryVisible') return
      recordLensPerformance('passiveEntryVisible', event.payload.durationMs)
    }).then(dispose => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch(error => {
      if (!disposed) setNotice(String(error))
    })
    return () => {
      disposed = true
      unlisten()
    }
  }, [recordLensPerformance])

  const closeLens = useCallback(async () => {
    const pinned = snapshotRef.current
    dispatchLensEvent({ type: 'lens_close' })
    await getCurrentWindow().hide()
    if (pinned?.sourceWindowIdentity !== undefined) {
      await restoreSourceFocus(pinned.id, pinned.revision).catch(() => undefined)
    }
  }, [dispatchLensEvent])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void closeLens()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [closeLens])

  const releaseSubscription = useCallback(async (session: ActiveSession): Promise<void> => {
    if (session.sessionId === null || session.subscriptionId === null) return
    try {
      await unsubscribeSession(session.sessionId, session.subscriptionId)
    } catch (error) {
      if (viewActive.current) setNotice(`Previous session subscription could not be released: ${String(error)}`)
    }
  }, [])

  const openSession = useCallback(async (nextSessionId: string) => {
    const generation = ++sessionGeneration.current
    const previous = active.current
    const previousSessionId = previous.sessionId ?? sessionId
    if (previousSessionId !== null) drafts.current.set(previousSessionId, draftValue.current)
    if (previousSessionId !== null && previousSessionId !== nextSessionId) {
      dispatchLensEvent({ type: 'session_switch' })
    }
    pendingSubmission.current = null
    active.current = { sessionId: null, requestId: null, subscriptionId: null }
    setSubscriptionState('connecting')
    setLastEventSequence(null)
    await releaseSubscription(previous)
    if (generation !== sessionGeneration.current || !viewActive.current) return

    setHistoryLoading(true)
    setHistoryError(null)
    setProjection(initialRequestProjection)
    setRequestId(null)
    try {
      const loaded = await readCompleteHistory(nextSessionId)
      if (generation !== sessionGeneration.current || !viewActive.current) return
      setSessionId(nextSessionId)
      setDraft(drafts.current.get(nextSessionId) ?? '')
      rememberSessionId(nextSessionId)
      setHistory(loaded.entries)
      cursors.current.set(nextSessionId, loaded.capturedThroughCursor)
      setLastEventSequence(loaded.capturedThroughCursor)
      const subscriptionId = `lens-${crypto.randomUUID()}`
      active.current = { sessionId: nextSessionId, requestId: null, subscriptionId }
      await listenerReady.current
      if (generation !== sessionGeneration.current || !viewActive.current) return
      await subscribeSession(nextSessionId, subscriptionId, loaded.capturedThroughCursor)
      if (generation !== sessionGeneration.current || !viewActive.current) {
        await unsubscribeSession(nextSessionId, subscriptionId).catch(() => undefined)
        return
      }
      setSubscriptionState('active')
      setNotice(null)
    } catch (error) {
      if (generation === sessionGeneration.current && viewActive.current) {
        active.current = { sessionId: null, requestId: null, subscriptionId: null }
        setSubscriptionState('error')
        setHistoryError(String(error))
        setNotice(copy.historyLoadFailed)
      }
    } finally {
      if (generation === sessionGeneration.current) setHistoryLoading(false)
    }
  }, [copy, dispatchLensEvent, releaseSubscription])

  useEffect(() => {
    if (sessions.length === 0 || sessionId !== null) return
    const preferred = rememberedSessionId()
    const first = sessions.find(session => session.id === preferred) ?? sessions[0]
    if (first !== undefined) void openSession(first.id)
  }, [openSession, sessionId, sessions])

  const acceptSubmission = useCallback(async (result: SessionSubmission) => {
    const generation = ++sessionGeneration.current
    const previous = active.current
    const pending = pendingSubmission.current
    if (pending !== null) {
      dispatchLensEvent({
        type: 'request_accepted',
        submittedRequestId: pending.requestId,
        requestId: result.requestId,
      })
    }
    active.current = { sessionId: null, requestId: null, subscriptionId: null }
    setSubscriptionState('connecting')
    await releaseSubscription(previous)
    if (!viewActive.current || generation !== sessionGeneration.current) return

    setSessionId(result.sessionId)
    setRequestId(result.requestId)
    if (previous.sessionId !== result.sessionId) setDraft(drafts.current.get(result.sessionId) ?? '')
    rememberSessionId(result.sessionId)
    pendingSubmission.current = null
    if (previous.sessionId !== result.sessionId) {
      setHistory([])
      cursors.current.delete(result.sessionId)
    }
    const subscriptionId = `lens-${crypto.randomUUID()}`
    active.current = { sessionId: result.sessionId, requestId: result.requestId, subscriptionId }
    try {
      if (previous.sessionId !== result.sessionId) {
        const loaded = await readCompleteHistory(result.sessionId)
        if (generation !== sessionGeneration.current || !viewActive.current) return
        setHistory(loaded.entries)
        cursors.current.set(result.sessionId, loaded.capturedThroughCursor)
        setLastEventSequence(loaded.capturedThroughCursor)
      }
      setLastEventSequence(cursors.current.get(result.sessionId) ?? null)
      await listenerReady.current
      if (!viewActive.current || generation !== sessionGeneration.current) return
      await subscribeSession(result.sessionId, subscriptionId, cursors.current.get(result.sessionId))
      if (!viewActive.current || generation !== sessionGeneration.current) {
        await unsubscribeSession(result.sessionId, subscriptionId).catch(() => undefined)
        return
      }
      setSubscriptionState('active')
      setProjection(previousProjection => previousProjection.phase === 'submitting' || previousProjection.phase === 'submission-unknown'
        ? { ...previousProjection, phase: 'queued' }
        : previousProjection)
      setNotice(`Waiting for Harness session ${result.sessionId}.`)
      void refreshSessions().catch(() => undefined)
    } catch (error) {
      if (generation !== sessionGeneration.current || !viewActive.current) return
      active.current = { sessionId: result.sessionId, requestId: result.requestId, subscriptionId: null }
      setSubscriptionState('error')
      setProjection(previousProjection => ({ ...previousProjection, phase: 'connection-lost', error: String(error) }))
    }
  }, [dispatchLensEvent, refreshSessions, releaseSubscription])

  const submissionFailed = useCallback((error: unknown) => {
    if (error instanceof SubmissionUnknownError) {
      const pending = pendingSubmission.current
      if (pending !== null) {
        dispatchLensEvent({
          type: 'request_accepted',
          submittedRequestId: pending.requestId,
          requestId: error.requestId,
        })
        pendingSubmission.current = { ...pending, sessionId: error.sessionId, requestId: error.requestId }
      }
      setSessionId(error.sessionId)
      setRequestId(error.requestId)
      setProjection(previous => ({ ...previous, phase: 'submission-unknown', error: null, notice: 'Harness may have accepted this request. Retry uses the same request identity.' }))
      setNotice(null)
      return
    }
    const pending = pendingSubmission.current
    if (pending !== null) dispatchLensEvent({ type: 'action_error', requestId: pending.requestId })
    pendingSubmission.current = null
    setProjection(previous => ({ ...previous, phase: 'error', error: String(error) }))
    setNotice(null)
  }, [dispatchLensEvent])

  useEffect(() => {
    active.current = { ...active.current, sessionId, requestId }
  }, [requestId, sessionId])

  useEffect(() => {
    viewActive.current = true
    let unlisten: () => void = () => undefined
    let disposed = false
    listenerReady.current = listen<SessionAgentEvent>('session-agent-event', event => {
      if (disposed) return
      const current = active.current
      const payload = event.payload
      if (current.sessionId === null || current.subscriptionId === null) return
      if (payload.sessionId !== current.sessionId || payload.subscriptionId !== current.subscriptionId) return
      if (payload.error !== undefined) {
        setSubscriptionState('error')
        setProjection(previous => ({ ...previous, phase: 'connection-lost', error: payload.error as string }))
        return
      }
      if (payload.event?.data.persistent) {
        const cursor = payload.event.data.cursor
        const nextCursor = Math.max(cursors.current.get(current.sessionId) ?? 0, cursor)
        cursors.current.set(current.sessionId, nextCursor)
        setLastEventSequence(nextCursor)
      }
      if (payload.history !== undefined) {
        setHistory(previous => mergeSessionHistory(previous, [payload.history as SessionHistoryEntry]))
      }
      if (current.requestId !== null && (
        payload.requestId === current.requestId
        || payload.requestIds?.includes(current.requestId) === true
        || payload.history?.requestId === current.requestId
      )) setNotice(null)
      if (current.requestId === null || payload.event === undefined) return
      const matchesRequest = payload.requestId === current.requestId
        || payload.requestIds?.includes(current.requestId) === true
      if (matchesRequest) {
        const value = payload.event.data.value
        if (payload.event.kind === 'error') {
          dispatchLensEvent({ type: 'action_error', requestId: current.requestId })
        } else {
          if (['assistant-delta', 'assistant-complete', 'tool-call', 'tool-result'].includes(payload.event.kind)) {
            dispatchLensEvent({ type: 'stream_start', requestId: current.requestId })
          }
          if (payload.event.kind === 'assistant-delta') {
            const delta = textDeltaFromEvent(value)
            if (delta !== null) dispatchLensEvent({ type: 'stream_delta', requestId: current.requestId, delta })
          }
          const outcome = payload.event.kind === 'status' ? streamOutcomeFromEvent(value) : null
          if (outcome !== null) {
            dispatchLensEvent({ type: 'stream_end', requestId: current.requestId, outcome })
            const pinned = snapshotRef.current
            const binding = lensStateRef.current.binding
            if (
              pinned?.sourceWindowIdentity !== undefined
              && binding !== null
              && sameLensSelection(binding, bindingForSelection(pinned))
            ) void restoreSourceFocus(pinned.id, pinned.revision).catch(() => undefined)
          }
        }
      }
      setProjection(previous => projectSessionEvent(previous, {
        sessionId: current.sessionId as string,
        requestId: current.requestId as string,
        subscriptionId: current.subscriptionId as string,
      }, payload))
    }).then(dispose => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch(error => {
      if (!disposed) setProjection(previous => ({ ...previous, phase: 'connection-lost', error: String(error) }))
    }).then(() => undefined)
    return () => {
      disposed = true
      viewActive.current = false
      unlisten()
      const current = active.current
      active.current = { sessionId: null, requestId: null, subscriptionId: null }
      void releaseSubscription(current)
    }
  }, [dispatchLensEvent, releaseSubscription])

  useEffect(() => {
    let disposed = false
    let unlisten: () => void = () => undefined
    void listen<SelectionCapturedEvent>('selection-captured', event => {
      if (disposed) return
      const binding = { snapshotId: event.payload.snapshotId, revision: event.payload.revision, openedAt: Date.now() }
      dispatchLensEvent({ type: 'selection_detected', binding })
    }).then(dispose => {
      if (disposed) dispose()
      else unlisten = dispose
    }).catch(error => {
      if (!disposed) setNotice(String(error))
    })
    return () => {
      disposed = true
      unlisten()
    }
  }, [dispatchLensEvent])

  const createAndOpenSession = () => {
    if (sessionsLoading || historyLoading) return
    setNotice('Creating a new Harness session…')
    void createSession()
      .then(async createdId => {
        await refreshSessions().catch(() => undefined)
        await openSession(createdId)
      })
      .catch(error => setNotice(`Unable to create a Harness session: ${String(error)}`))
  }

  const submit = (next: Exclude<Action, null>) => {
    if (busy) return
    if (next === 'ask' && draft.trim().length === 0) return
    if (snapshot === null) return
    if (!sameLensSelection(lensStateRef.current.binding, bindingForSelection(snapshot))) {
      setNotice(copy.lensBindingUnavailable)
      return
    }
    const instruction = next === 'explain'
      ? 'Explain the selected material clearly.'
      : draft.trim()
    const material = isAuthorizationCurrent(authorizedMaterial, snapshot)
      ? authorizedMaterial
      : defaultAuthorizedMaterial(snapshot)
    const prompt = buildAuthorizedMaterialPrompt(material, instruction)
    const logicalRequestId = `selection-${crypto.randomUUID()}`
    dispatchLensEvent({ type: 'action_submit', action: next, requestId: logicalRequestId })
    pendingSubmission.current = {
      sessionId,
      requestId: logicalRequestId,
      action: next,
      prompt,
      material: snapshot,
      authorizedMaterial: material,
    }
    sessionGeneration.current += 1
    const previous = active.current
    active.current = { sessionId: null, requestId: null, subscriptionId: null }
    void releaseSubscription(previous)
    setAction(next)
    setRequestId(null)
    setProjection({ ...initialRequestProjection, phase: 'submitting' })
    setNotice('Submitting the authorized request to Harness…')
    void submitSessionPrompt(sessionId, prompt, logicalRequestId, snapshot, material).then(acceptSubmission).catch(submissionFailed)
  }

  const retrySubmission = () => {
    const pending = pendingSubmission.current
    if (pending === null || projection.phase !== 'submission-unknown') return
    setProjection(previous => ({ ...previous, phase: 'submitting', notice: null }))
    setNotice('Checking the existing request with Harness…')
    void submitSessionPrompt(
      pending.sessionId,
      pending.prompt,
      pending.requestId,
      pending.material,
      pending.authorizedMaterial,
    ).then(acceptSubmission).catch(submissionFailed)
  }

  const stop = () => {
    if (sessionId === null || requestId === null) return
    setProjection(previous => ({ ...previous, phase: 'cancelling' }))
    void cancelSession(sessionId).then(cancelled => {
      if (!cancelled) {
        dispatchLensEvent({ type: 'action_error', requestId })
        setProjection(previous => previous.phase === 'cancelling'
          ? { ...previous, phase: 'error', error: 'Harness session was no longer running.' }
          : previous)
      }
      setNotice(null)
    }).catch(error => {
      dispatchLensEvent({ type: 'action_error', requestId })
      setProjection(previous => previous.phase === 'cancelling'
        ? { ...previous, phase: 'error', error: String(error) }
        : previous)
      setNotice(null)
    })
  }

  const copyAnswer = () => {
    if (projection.answer === '') return
    if (navigator.clipboard === undefined) {
      setNotice(copy.copyUnavailable)
      return
    }
    void navigator.clipboard.writeText(projection.answer)
      .then(() => setNotice(copy.answerCopied))
      .catch(() => setNotice(copy.copyFailed))
  }

  const loadContext = useCallback(() => {
    if (snapshot === null || contextLoading) return
    const identity = `${snapshot.id}:${snapshot.revision}`
    setExpandedContext(null)
    setAuthorizedMaterial(defaultAuthorizedMaterial(snapshot))
    setContextLoading(true)
    setContextError(null)
    void expandSelection(snapshot.id, contextScope)
      .then(result => {
        if (
          result.snapshotId !== snapshot.id
          || result.scope !== contextScope
          || result.revision !== snapshot.revision
        ) {
          throw new Error(copy.contextChanged)
        }
        if (snapshotIdentityRef.current === identity) setExpandedContext(result)
      })
      .catch(error => {
        if (snapshotIdentityRef.current === identity) setContextError(String(error))
      })
      .finally(() => setContextLoading(false))
  }, [contextLoading, contextScope, copy, snapshot])

  const authorizeContext = useCallback(() => {
    if (snapshot === null || expandedContext === null) return
    try {
      const material = authorizeExpandedContext(snapshot, expandedContext)
      if (material.actualScope !== contextScope) throw new Error('Loaded context does not match the selected authorization scope.')
      setAuthorizedMaterial(material)
      setContextError(null)
    } catch (error) {
      setAuthorizedMaterial(defaultAuthorizedMaterial(snapshot))
      setContextError(String(error))
    }
  }, [contextScope, expandedContext, snapshot])

  const changeContextScope = useCallback((nextScope: ExpandableContextScope) => {
    setContextScope(nextScope)
    setExpandedContext(null)
    setContextError(null)
    if (snapshot !== null) setAuthorizedMaterial(defaultAuthorizedMaterial(snapshot))
  }, [snapshot])

  const source = snapshot?.document?.title ?? snapshot?.source.windowTitle ?? snapshot?.source.app ?? copy.currentSelection
  const displayedContext = expandedContext?.context ?? snapshot?.context
  const contextItems: readonly { readonly label: string; readonly text: string }[] = displayedContext === undefined ? [] : [
    { label: copy.contextBefore, text: displayedContext.before },
    { label: copy.contextAfter, text: displayedContext.after },
    { label: copy.contextSection, text: displayedContext.sectionText },
    { label: copy.contextPage, text: displayedContext.pageText },
  ].filter((item): item is { readonly label: string; readonly text: string } => typeof item.text === 'string' && item.text.length > 0)
  const contextScopes: readonly { readonly value: ExpandableContextScope; readonly label: string }[] = snapshot === null ? [] : [
    ...(snapshot.capabilities.localContext ? [{ value: 'local' as const, label: copy.contextScopeLocal }] : []),
    ...(snapshot.capabilities.sectionContext ? [{ value: 'section' as const, label: copy.contextScopeSection }] : []),
    ...(snapshot.capabilities.pageContext && snapshot.context.pageAvailable ? [{ value: 'page' as const, label: copy.contextScopePage }] : []),
  ]
  const currentAuthorization = isAuthorizationCurrent(authorizedMaterial, snapshot) ? authorizedMaterial : null
  const authorizedScope = currentAuthorization?.authorizedScope ?? 'selection'
  const requestMaterial = currentAuthorization ?? (snapshot === null ? null : defaultAuthorizedMaterial(snapshot))
  const requestMaterialPreview = requestMaterial === null ? '' : renderAuthorizedMaterialReference(requestMaterial)
  const canAuthorizePreview = expandedContext !== null
    && snapshot !== null
    && expandedContext.snapshotId === snapshot.id
    && expandedContext.revision === snapshot.revision
    && expandedContext.scope === contextScope
    && authorizedScope !== contextScope
  const showAnswer = projection.answer !== ''
  const phaseLabel = copy.phaseLabels[projection.phase] ?? projection.phase
  const isChinese = copy.locale === 'zh-CN'
  const ui = isChinese
    ? {
        selectedText: 'Selected text',
        reselect: '重新选择',
        persistentHistory: '持久历史',
        heroTitle: '基于选中文本提问',
        heroDescription: '选中的文本和经过授权的附近上下文会作为本次请求的 Context。',
        ready: '准备就绪',
        waiting: '等待选区',
        captureError: '采集异常',
        paused: '采集已暂停',
        openMainChat: '打开主对话',
        selectFirst: '请先在 Chrome / Edge 中选择文本',
        composerWaiting: '选择文本后即可提问',
        selectionSummary: (lines: number, chars: number) => `已选择 ${lines} 行文本 · 约 ${chars} 个字`,
      }
    : {
        selectedText: 'Selected text',
        reselect: 'Reselect',
        persistentHistory: 'Persistent history',
        heroTitle: 'Ask about this selection',
        heroDescription: 'The selected text and explicitly authorized nearby context are attached to this request.',
        ready: 'Ready',
        waiting: 'Waiting for selection',
        captureError: 'Capture error',
        paused: 'Capture paused',
        openMainChat: 'Open main chat',
        selectFirst: 'Select text in Chrome / Edge first',
        composerWaiting: 'Select text to start asking',
        selectionSummary: (lines: number, chars: number) => `${lines} line${lines === 1 ? '' : 's'} selected · about ${chars} characters`,
      }
  const sourceApp = snapshot?.source.app ?? snapshot?.source.process ?? snapshot?.provider ?? ''
  const sourceKind = snapshot?.source.kind ?? ''
  const selectedText = snapshot?.selection.text ?? ''
  const selectedTextCharacters = Array.from(selectedText)
  const selectedLines = selectedText === '' ? 0 : selectedText.split(/\r?\n/).length
  const selectedChars = selectedTextCharacters.length
  const selectionPreviewTruncated = !selectionExpanded && selectedChars > SELECTION_PREVIEW_LIMIT
  const displayedSelectedText = selectionPreviewTruncated
    ? `${selectedTextCharacters.slice(0, SELECTION_PREVIEW_LIMIT).join('')}…`
    : selectedText
  const sourceInitial = sourceApp.trim().slice(0, 1).toUpperCase() || '•'
  const diagnosticsLabel = copy.locale === 'zh-CN' ? '运行诊断' : 'Diagnostics'
  const captureStatusLabel = capture.paused
    ? ui.paused
    : capture.lastError !== null || capture.phase === 'error'
      ? ui.captureError
      : snapshot === null
        ? ui.waiting
        : ui.ready
  const hasPendingSelection = lensState.binding !== null
    && lensState.latestSelection !== null
    && !sameLensSelection(lensState.binding, lensState.latestSelection)

  if (diagnosticsOpen) return <DiagnosticsPage
    locale={copy.locale}
    lens={lensState}
    lensPerformance={lensPerformance}
    pinnedSnapshot={snapshot}
    sessionId={sessionId}
    requestId={requestId}
    lastEventSequence={lastEventSequence}
    subscriptionState={subscriptionState}
    onBack={() => setDiagnosticsOpen(false)}
  />

  return <main className="lens" data-testid="selection-lens" data-phase={projection.phase} lang={copy.locale}>
    <header className="lens-header" data-tauri-drag-region>
      <div className="brand-lockup" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span className="brand" data-tauri-drag-region>DeepSeek</span>
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-tagline" data-tauri-drag-region>{copy.brandTagline}</span>
      </div>
      <button className="icon-button" type="button" onClick={() => void closeLens()} aria-label={copy.close}>×</button>
    </header>

    {snapshot === null ? <section className="empty-state" aria-live="polite">
      <div className="empty-source-row">
        <span className="selection-source-dot waiting" aria-hidden="true" />
        <div><strong>{copy.emptyTitle}</strong><span>{ui.selectFirst}</span></div>
        <button type="button" className="secondary compact-button" onClick={() => void refresh()}>{copy.refreshSelection}</button>
      </div>
    </section> : <section className="material" aria-label={copy.materialAriaLabel}>
      <div className="selection-source-row">
        <div className="selection-source">
          <span className="selection-source-dot" aria-hidden="true" />
          <span className={`source-app-mark source-${sourceKind}`} aria-hidden="true">{sourceInitial}</span>
          <strong>{sourceApp}</strong>
          <span className="selection-source-divider" aria-hidden="true">·</span>
          <span className="source-kind">{sourceKind}</span>
        </div>
        <span className="source-chevron" aria-hidden="true">⌄</span>
      </div>
      <p className="selection-caption">{ui.selectedText}</p>
      <blockquote data-testid="selected-text">{displayedSelectedText}</blockquote>
      {selectedChars > SELECTION_PREVIEW_LIMIT ? <button
        type="button"
        className="text-button selection-expand-button"
        onClick={() => setSelectionExpanded(expanded => !expanded)}
      >{selectionExpanded ? copy.showLessSelection : copy.showFullSelection}</button> : null}
      <div className="selection-meta-row">
        <span>{ui.selectionSummary(selectedLines, selectedChars)}</span>
        <button type="button" className="secondary compact-button" onClick={() => void refresh(true)} disabled={busy}>⌗ <span>{ui.reselect}</span></button>
      </div>
      <p className="material-note">{copy.fixedMaterial(snapshot.revision)}</p>
      {hasPendingSelection ? <div className="selection-update" role="status">
        <span>{copy.selectionAvailable}</span>
        <button type="button" className="secondary compact-button" onClick={() => void refresh(true)} disabled={busy}>{copy.useLatest}</button>
      </div> : null}
      <details className="context-panel" data-testid="captured-context">
        <summary>{copy.contextLabel}</summary>
        <div className="context-panel-body">
          <p className="context-description">{copy.contextDescription}</p>
          {contextScopes.length > 0 ? <div className="context-controls">
            <label htmlFor="context-scope">{copy.contextScopeLabel}</label>
            <select id="context-scope" value={contextScope} disabled={contextLoading || busy} onChange={event => changeContextScope(event.target.value as ExpandableContextScope)}>{contextScopes.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
            <button type="button" className="secondary" onClick={loadContext} disabled={contextLoading || busy}>{contextLoading ? copy.contextLoading : copy.contextLoad}</button>
          </div> : null}
          {expandedContext ? <p className="context-result" role="status">{expandedContext.completeness === 'partial' ? copy.contextPartial : copy.contextComplete}{expandedContext.truncated ? ` · ${copy.contextTruncated}` : ''}</p> : null}
          <p className="context-result" data-testid="request-context-authorization" role="status">{authorizedScope === 'selection' ? copy.contextAuthorizationSelection : copy.contextAuthorizationExpanded(authorizedScope)}</p>
          {canAuthorizePreview ? <button type="button" className="secondary authorization-button" data-testid="authorize-context" onClick={authorizeContext} disabled={busy}>{copy.contextAuthorize(contextScope)}</button> : null}
          {contextError ? <p className="context-error" role="alert">{contextError}</p> : null}
          {contextItems.length === 0 ? <p className="context-none">{copy.contextNone}</p> : <div className="context-list">{contextItems.map(item => <div className="context-item" key={item.label}><span className="context-item-label">{item.label}</span><pre>{item.text}</pre></div>)}</div>}
          <details className="request-material-preview-panel" data-testid="request-material-preview-panel">
            <summary>{copy.requestMaterialPreview}</summary>
            <pre data-testid="request-material-preview">{requestMaterialPreview}</pre>
          </details>
        </div>
      </details>
    </section>}

    <section className="session-bar" aria-label={copy.sessionAriaLabel}>
      <div className="session-heading">
        <span className="session-title">{copy.sessionTitle}</span>
        <details className="history-drawer">
          <summary>{ui.persistentHistory} <span aria-hidden="true">›</span></summary>
          <div className="history-popover">
            {historyLoading ? <p className="history-state">{copy.restoringHistory}</p> : null}
            {historyError ? <p className="history-state error" role="alert">{historyError}</p> : null}
            {history.length > 0 ? <section className="history" aria-label={copy.historyAriaLabel}>
              <div className="history-heading"><span>{copy.historyLabel}</span><span>{copy.messages(history.length)}</span></div>
              <div className="history-list">
                {history.map(entry => <article className={`history-entry ${entry.role}`} key={entry.seq} data-testid={`history-entry-${entry.seq}`}>
                  <div className="history-meta"><span>{entry.role === 'user' ? copy.you : copy.harness}</span>{entry.sourceKind ? <span>{entry.sourceKind}</span> : null}</div>
                  <p>{entry.text}</p>
                </article>)}
              </div>
            </section> : <p className="history-state">{isChinese ? '当前会话暂无历史消息。' : 'No durable messages in this session yet.'}</p>}
          </div>
        </details>
      </div>
      <div className="session-controls">
        <select aria-label={copy.sessionSelectAriaLabel} value={sessionId ?? ''} disabled={sessionsLoading || historyLoading} onChange={event => { if (event.target.value !== '') void openSession(event.target.value) }}>
          {sessionId === null ? <option value="">{copy.noSession}</option> : null}
          {sessions.map((session, index) => <option value={session.id} key={session.id}>{sessionLabel(session, index, copy)} · {sessionStatusLabel(session, copy)}</option>)}
        </select>
        <button type="button" className="secondary new-session-button" onClick={createAndOpenSession} disabled={sessionsLoading || historyLoading}><span aria-hidden="true">＋</span>{copy.newSession}</button>
      </div>
      <p className="session-navigation-note sr-only" role="note">{copy.navigationUnavailable}</p>
    </section>

    <section className="ask-hero" aria-hidden="true">
      <div className="hero-mark">✦</div>
      <h1>{snapshot === null ? copy.emptyTitle : ui.heroTitle}</h1>
      <p>{snapshot === null ? copy.emptyDescription : ui.heroDescription}</p>
    </section>

    <section className={`composer-shell ${snapshot === null ? 'composer-waiting' : ''}`}>
      <label className="question-label sr-only" htmlFor="question">{copy.askLabel}</label>
      <textarea
        id="question"
        value={draft}
        maxLength={COMPOSER_LIMIT}
        disabled={snapshot === null || busy}
        onChange={event => {
          const value = event.target.value
          setDraft(value)
          if (sessionId !== null) drafts.current.set(sessionId, value)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit('ask')
          }
        }}
        placeholder={snapshot === null ? ui.composerWaiting : copy.askPlaceholder}
        rows={4}
      />
      <span className="composer-count" aria-hidden="true">{Array.from(draft).length} / {COMPOSER_LIMIT}</span>
      <button className="send-button" type="button" onClick={() => submit('ask')} disabled={snapshot === null || busy || draft.trim().length === 0} aria-label={copy.ask}>➤</button>
    </section>

    {snapshot !== null ? <button type="button" className="sr-only-action" data-testid="explain-action" onClick={() => submit('explain')} disabled={busy}>{copy.explain}</button> : null}

    {showAnswer ? <section className={`answer ${projection.phase === 'streaming' ? 'answer-live' : ''}`} aria-label={copy.answerLabel} aria-live={projection.phase === 'streaming' ? 'polite' : undefined}>
      <div className="answer-heading"><span>{copy.answerLabel}</span><button className="text-button" type="button" onClick={copyAnswer}>{copy.copyAnswer}</button></div>
      <p>{projection.answer}</p>
    </section> : null}
    {(['queued', 'streaming'] as RequestPhase[]).includes(projection.phase) ? <button type="button" className="secondary session-action" onClick={stop}>{copy.stopSession}</button> : null}
    {projection.phase === 'submission-unknown' ? <button type="button" className="secondary session-action" onClick={retrySubmission}>{copy.retrySafely}</button> : null}

    {projection.error ? <p className="notice error" role="alert">{projection.error}</p> : null}
    {notice ?? projection.notice ? <p className="notice" role="status">{notice ?? projection.notice}</p> : null}

    <footer>
      <button
        type="button"
        className="status-control"
        aria-label={capture.paused ? copy.resumeCapture : copy.pauseCapture}
        onClick={() => void (capture.paused ? resumeCapture() : pauseCapture()).then(nextCapture => {
          setCapture(nextCapture)
          dispatchLensEvent({ type: nextCapture.paused ? 'capture_paused' : 'capture_resumed' })
          void emit('capture-state-changed', nextCapture)
        })}
      >
        <span className={`status-dot ${capture.paused ? 'paused' : capture.lastError ? 'error' : snapshot === null ? 'waiting' : ''}`} aria-hidden="true" />
        <span>{captureStatusLabel}</span>
      </button>
      <span className="phase-live" aria-live="polite">{action === null ? copy.phaseLabels.idle : phaseLabel}</span>
      <button type="button" className="diagnostics-link" onClick={() => setDiagnosticsOpen(true)}>{diagnosticsLabel}</button>
      <button type="button" className="main-chat-link" onClick={() => setNotice(copy.navigationUnavailable)}>{ui.openMainChat} <span aria-hidden="true">↗</span></button>
    </footer>
  </main>
}
