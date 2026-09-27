export type LensAction = 'explain' | 'translate' | 'ask' | 'send-to-agent'
export type LensView = 'hidden' | 'passive-entry' | 'lens-open'
export type LensRequestPhase = 'idle' | 'submitting' | 'streaming' | 'completed' | 'cancelled' | 'error'

export interface LensBinding {
  readonly snapshotId: string
  readonly revision: number
  readonly openedAt: number
}

export interface LensRequestState {
  readonly phase: LensRequestPhase
  readonly requestId: string | null
  readonly action: LensAction | null
  readonly receivedDeltas: number
  readonly receivedCharacters: number
}

export interface LensState {
  readonly view: LensView
  /** The newest selection available to the passive entry. */
  readonly latestSelection: LensBinding | null
  /** The immutable selection currently used by the open Lens. */
  readonly binding: LensBinding | null
  readonly request: LensRequestState
  readonly capturePaused: boolean
  readonly shutdown: boolean
}

export type LensEvent =
  | { readonly type: 'selection_detected'; readonly binding: LensBinding }
  | { readonly type: 'entry_open' }
  | { readonly type: 'lens_open' }
  | { readonly type: 'lens_close' }
  | { readonly type: 'use_latest_selection' }
  | { readonly type: 'action_submit'; readonly action: LensAction; readonly requestId: string }
  | { readonly type: 'request_accepted'; readonly submittedRequestId: string; readonly requestId: string }
  | { readonly type: 'stream_start'; readonly requestId: string }
  | { readonly type: 'stream_delta'; readonly requestId: string; readonly delta: string }
  | { readonly type: 'stream_end'; readonly requestId: string; readonly outcome?: 'completed' | 'cancelled' | 'error' }
  | { readonly type: 'action_error'; readonly requestId: string }
  | { readonly type: 'session_switch' }
  | { readonly type: 'source_invalidated'; readonly binding?: LensBinding }
  | { readonly type: 'capture_paused' }
  | { readonly type: 'capture_resumed' }
  | { readonly type: 'shutdown' }

export const initialLensState: LensState = {
  view: 'hidden',
  latestSelection: null,
  binding: null,
  request: {
    phase: 'idle',
    requestId: null,
    action: null,
    receivedDeltas: 0,
    receivedCharacters: 0,
  },
  capturePaused: false,
  shutdown: false,
}

export function sameLensSelection(
  left: LensBinding | null | undefined,
  right: LensBinding | null | undefined,
): boolean {
  if (left == null || right == null) return left === right
  return left.snapshotId === right.snapshotId && left.revision === right.revision
}

export function isLensBinding(value: unknown): value is LensBinding {
  if (value === null || typeof value !== 'object') return false
  const binding = value as Record<string, unknown>
  return typeof binding.snapshotId === 'string'
    && binding.snapshotId.length > 0
    && Number.isSafeInteger(binding.revision)
    && (binding.revision as number) >= 0
    && Number.isSafeInteger(binding.openedAt)
    && (binding.openedAt as number) >= 0
}

/**
 * Apply one UI/runtime event. Selection identity and the active Lens binding
 * are separate so a newer capture cannot silently replace material in use.
 */
export function transitionLens(state: LensState, event: LensEvent): LensState {
  if (state.shutdown && event.type !== 'shutdown') return state

  switch (event.type) {
    case 'selection_detected': {
      if (state.capturePaused || !isLensBinding(event.binding)) return state
      if (sameLensSelection(state.latestSelection, event.binding)) return state
      return {
        ...state,
        view: state.view === 'hidden' ? 'passive-entry' : state.view,
        latestSelection: event.binding,
      }
    }
    case 'entry_open':
      if (state.view !== 'passive-entry' || state.latestSelection === null || state.capturePaused) return state
      return { ...state, view: 'lens-open', binding: state.latestSelection }
    case 'lens_open':
      if (state.latestSelection === null || state.capturePaused) return state
      if (state.view === 'lens-open') return state
      return { ...state, view: 'lens-open', binding: state.latestSelection }
    case 'lens_close':
      if (state.view === 'hidden' && state.binding === null) return state
      return { ...state, view: 'hidden', binding: null }
    case 'use_latest_selection':
      if (
        state.view !== 'lens-open'
        || state.latestSelection === null
        || sameLensSelection(state.binding, state.latestSelection)
        || state.request.phase === 'submitting'
        || state.request.phase === 'streaming'
      ) return state
      return { ...state, binding: state.latestSelection }
    case 'action_submit':
      if (
        state.view !== 'lens-open'
        || state.binding === null
        || event.requestId.length === 0
        || state.request.phase === 'submitting'
        || state.request.phase === 'streaming'
      ) return state
      return {
        ...state,
        request: {
          phase: 'submitting',
          requestId: event.requestId,
          action: event.action,
          receivedDeltas: 0,
          receivedCharacters: 0,
        },
      }
    case 'stream_start':
      if (state.request.requestId !== event.requestId || state.request.phase !== 'submitting') return state
      return { ...state, request: { ...state.request, phase: 'streaming' } }
    case 'request_accepted':
      if (
        state.request.requestId !== event.submittedRequestId
        || state.request.phase !== 'submitting'
        || event.requestId.length === 0
      ) return state
      return event.requestId === state.request.requestId
        ? state
        : { ...state, request: { ...state.request, requestId: event.requestId } }
    case 'stream_delta':
      if (state.request.requestId !== event.requestId || state.request.phase !== 'streaming') return state
      return {
        ...state,
        request: {
          ...state.request,
          receivedDeltas: state.request.receivedDeltas + 1,
          receivedCharacters: state.request.receivedCharacters + event.delta.length,
        },
      }
    case 'stream_end': {
      if (
        state.request.requestId !== event.requestId
        || (state.request.phase !== 'submitting' && state.request.phase !== 'streaming')
      ) return state
      const outcome = event.outcome ?? 'completed'
      return { ...state, request: { ...state.request, phase: outcome } }
    }
    case 'action_error':
      if (
        state.request.requestId !== event.requestId
        || (state.request.phase !== 'submitting' && state.request.phase !== 'streaming')
      ) return state
      return { ...state, request: { ...state.request, phase: 'error' } }
    case 'session_switch':
      return state.request.phase === 'idle'
        ? state
        : { ...state, request: initialLensState.request }
    case 'source_invalidated': {
      const activeMatches = event.binding === undefined || sameLensSelection(state.binding, event.binding)
      const latestMatches = event.binding === undefined || sameLensSelection(state.latestSelection, event.binding)
      if (!activeMatches && !latestMatches) return state
      const binding = activeMatches ? null : state.binding
      const latestSelection = latestMatches ? null : state.latestSelection
      return {
        ...state,
        view: activeMatches ? (latestSelection === null ? 'hidden' : 'passive-entry') : state.view,
        binding,
        latestSelection,
      }
    }
    case 'capture_paused':
      if (state.capturePaused) return state
      return {
        ...state,
        view: state.view === 'passive-entry' ? 'hidden' : state.view,
        capturePaused: true,
      }
    case 'capture_resumed':
      return state.capturePaused ? { ...state, capturePaused: false } : state
    case 'shutdown':
      return {
        ...state,
        view: 'hidden',
        latestSelection: null,
        binding: null,
        shutdown: true,
      }
  }
}
