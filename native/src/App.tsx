import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  cancelSession,
  createSession,
  expandSelection,
  getCaptureStatus,
  getCurrentSelection,
  listSessions,
  pauseCapture,
  readSessionHistory,
  resumeCapture,
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
    coalesced: 0,
    noSelection: 0,
    notApplicable: 0,
    excluded: 0,
    errors: 0,
    lastCaptureLatencyMs: null,
  },
}

type Action = 'explain' | 'ask' | null
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

export default function App() {
  const copy = getAppCopy()
  const [capture, setCapture] = useState<CaptureStatus>(emptyCapture)
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
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
  const busy = ['submitting', 'queued', 'streaming', 'cancelling', 'submission-unknown'].includes(projection.phase)
  const busyRef = useRef(busy)
  const pendingSelectionRefresh = useRef(false)
  const active = useRef<ActiveSession>({ sessionId: null, requestId: null, subscriptionId: null })
  const cursors = useRef(new Map<string, number>())
  const drafts = useRef(new Map<string, string>())
  const draftValue = useRef('')
  const sessionGeneration = useRef(0)
  const pendingSubmission = useRef<{
    sessionId: string | null
    requestId: string
    prompt: string
    material: SelectionSnapshot
    authorizedMaterial: SelectionMaterial
  } | null>(null)
  const listenerReady = useRef<Promise<void>>(Promise.resolve())
  const viewActive = useRef(true)
  const snapshotIdentityRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const [nextCapture, nextSnapshot] = await Promise.all([getCaptureStatus(), getCurrentSelection()])
    setCapture(nextCapture)
    setSnapshot(nextSnapshot)
  }, [])

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      setSessions(await listSessions())
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => { void refresh().catch(error => setNotice(String(error))) }, [refresh])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => {
    if (busy || !pendingSelectionRefresh.current) return
    pendingSelectionRefresh.current = false
    void refresh().catch(error => setNotice(String(error)))
  }, [busy, refresh])
  useEffect(() => {
    const identity = snapshot === null ? null : `${snapshot.id}:${snapshot.revision}`
    snapshotIdentityRef.current = identity
    setExpandedContext(null)
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
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void getCurrentWindow().hide()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

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
    pendingSubmission.current = null
    active.current = { sessionId: null, requestId: null, subscriptionId: null }
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
      const subscriptionId = `lens-${crypto.randomUUID()}`
      active.current = { sessionId: nextSessionId, requestId: null, subscriptionId }
      await listenerReady.current
      if (generation !== sessionGeneration.current || !viewActive.current) return
      await subscribeSession(nextSessionId, subscriptionId, loaded.capturedThroughCursor)
      if (generation !== sessionGeneration.current || !viewActive.current) {
        await unsubscribeSession(nextSessionId, subscriptionId).catch(() => undefined)
        return
      }
      setNotice(null)
    } catch (error) {
      if (generation === sessionGeneration.current && viewActive.current) {
        active.current = { sessionId: null, requestId: null, subscriptionId: null }
        setHistoryError(String(error))
        setNotice(copy.historyLoadFailed)
      }
    } finally {
      if (generation === sessionGeneration.current) setHistoryLoading(false)
    }
  }, [copy, releaseSubscription])

  useEffect(() => {
    if (sessions.length === 0 || sessionId !== null) return
    const preferred = rememberedSessionId()
    const first = sessions.find(session => session.id === preferred) ?? sessions[0]
    if (first !== undefined) void openSession(first.id)
  }, [openSession, sessionId, sessions])

  const acceptSubmission = useCallback(async (result: SessionSubmission) => {
    const generation = ++sessionGeneration.current
    const previous = active.current
    active.current = { sessionId: null, requestId: null, subscriptionId: null }
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
      }
      await listenerReady.current
      if (!viewActive.current || generation !== sessionGeneration.current) return
      await subscribeSession(result.sessionId, subscriptionId, cursors.current.get(result.sessionId))
      if (!viewActive.current || generation !== sessionGeneration.current) {
        await unsubscribeSession(result.sessionId, subscriptionId).catch(() => undefined)
        return
      }
      setProjection(previousProjection => previousProjection.phase === 'submitting' || previousProjection.phase === 'submission-unknown'
        ? { ...previousProjection, phase: 'queued' }
        : previousProjection)
      setNotice(`Waiting for Harness session ${result.sessionId}.`)
      void refreshSessions().catch(() => undefined)
    } catch (error) {
      if (generation !== sessionGeneration.current || !viewActive.current) return
      active.current = { sessionId: result.sessionId, requestId: result.requestId, subscriptionId: null }
      setProjection(previousProjection => ({ ...previousProjection, phase: 'connection-lost', error: String(error) }))
    }
  }, [refreshSessions, releaseSubscription])

  const submissionFailed = useCallback((error: unknown) => {
    if (error instanceof SubmissionUnknownError) {
      const pending = pendingSubmission.current
      if (pending !== null) pendingSubmission.current = { ...pending, sessionId: error.sessionId, requestId: error.requestId }
      setSessionId(error.sessionId)
      setRequestId(error.requestId)
      setProjection(previous => ({ ...previous, phase: 'submission-unknown', error: null, notice: 'Harness may have accepted this request. Retry uses the same request identity.' }))
      setNotice(null)
      return
    }
    pendingSubmission.current = null
    setProjection(previous => ({ ...previous, phase: 'error', error: String(error) }))
    setNotice(null)
  }, [])

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
        setProjection(previous => ({ ...previous, phase: 'connection-lost', error: payload.error as string }))
        return
      }
      if (payload.event?.data.persistent) {
        const cursor = payload.event.data.cursor
        cursors.current.set(current.sessionId, Math.max(cursors.current.get(current.sessionId) ?? 0, cursor))
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
  }, [releaseSubscription])

  useEffect(() => {
    let disposed = false
    let unlisten: () => void = () => undefined
    void listen<SelectionCapturedEvent>('selection-captured', event => {
      if (disposed) return
      if (busyRef.current) {
        pendingSelectionRefresh.current = true
        return
      }
      void refresh()
        .then(() => {
          if (!disposed) setNotice(copy.selectionUpdated)
        })
        .catch(error => {
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
  }, [copy.selectionUpdated, refresh])

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
    const instruction = next === 'explain'
      ? 'Explain the selected material clearly.'
      : draft.trim()
    const material = isAuthorizationCurrent(authorizedMaterial, snapshot)
      ? authorizedMaterial
      : defaultAuthorizedMaterial(snapshot)
    const prompt = buildAuthorizedMaterialPrompt(material, instruction)
    const logicalRequestId = `selection-${crypto.randomUUID()}`
    pendingSubmission.current = {
      sessionId,
      requestId: logicalRequestId,
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
        setProjection(previous => previous.phase === 'cancelling'
          ? { ...previous, phase: 'error', error: 'Harness session was no longer running.' }
          : previous)
      }
      setNotice(null)
    }).catch(error => {
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
  const selectedLines = selectedText === '' ? 0 : selectedText.split(/\r?\n/).length
  const selectedChars = Array.from(selectedText).length
  const sourceInitial = sourceApp.trim().slice(0, 1).toUpperCase() || '•'
  const captureStatusLabel = capture.paused
    ? ui.paused
    : capture.lastError !== null || capture.phase === 'error'
      ? ui.captureError
      : snapshot === null
        ? ui.waiting
        : ui.ready

  return <main className="lens" data-testid="selection-lens" data-phase={projection.phase} lang={copy.locale}>
    <header className="lens-header" data-tauri-drag-region>
      <div className="brand-lockup" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span className="brand" data-tauri-drag-region>DeepSeek</span>
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-tagline" data-tauri-drag-region>{copy.brandTagline}</span>
      </div>
      <button className="icon-button" type="button" onClick={() => void getCurrentWindow().hide()} aria-label={copy.close}>×</button>
    </header>

    {snapshot === null ? <section className="empty-state" aria-live="polite">
      <div className="empty-source-row">
        <span className="selection-source-dot waiting" aria-hidden="true" />
        <div><strong>{copy.emptyTitle}</strong><span>{ui.selectFirst}</span></div>
        <button type="button" className="secondary compact-button" onClick={() => void refresh()}>{copy.refreshSelection}</button>
      </div>
      {capture.lastError ? <p className="capture-diagnostic" role="alert">{capture.lastError}</p> : null}
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
      <blockquote data-testid="selected-text">{snapshot.selection.text}</blockquote>
      <div className="selection-meta-row">
        <span>{ui.selectionSummary(selectedLines, selectedChars)}</span>
        <button type="button" className="secondary compact-button" onClick={() => void refresh()} disabled={busy}>⌗ <span>{ui.reselect}</span></button>
      </div>
      <p className="material-note">{copy.fixedMaterial(snapshot.revision)}</p>
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
          {canAuthorizePreview ? <button type="button" className="secondary authorization-button" onClick={authorizeContext} disabled={busy}>{copy.contextAuthorize(contextScope)}</button> : null}
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

    {snapshot !== null ? <button type="button" className="sr-only-action" onClick={() => submit('explain')} disabled={busy}>{copy.explain}</button> : null}

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
        onClick={() => void (capture.paused ? resumeCapture() : pauseCapture()).then(setCapture)}
      >
        <span className={`status-dot ${capture.paused ? 'paused' : capture.lastError ? 'error' : snapshot === null ? 'waiting' : ''}`} aria-hidden="true" />
        <span>{captureStatusLabel}</span>
      </button>
      <span className="phase-live" aria-live="polite">{action === null ? copy.phaseLabels.idle : phaseLabel}</span>
      <button type="button" className="main-chat-link" onClick={() => setNotice(copy.navigationUnavailable)}>{ui.openMainChat} <span aria-hidden="true">↗</span></button>
    </footer>
  </main>
}
