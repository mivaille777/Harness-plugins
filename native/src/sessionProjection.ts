import type { SessionAgentEvent } from './api/bridge'

export type RequestPhase =
  | 'idle'
  | 'submitting'
  | 'queued'
  | 'streaming'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'error'
  | 'connection-lost'
  | 'submission-unknown'

export interface ActiveRequest {
  readonly sessionId: string
  readonly requestId: string
  readonly subscriptionId: string
}

export interface RequestProjection {
  readonly phase: RequestPhase
  readonly answer: string
  readonly error: string | null
  readonly notice: string | null
  readonly lastCursor: number | null
  readonly steps: Readonly<Record<string, string>>
  readonly stepOrder: readonly string[]
}

export const initialRequestProjection: RequestProjection = {
  phase: 'idle',
  answer: '',
  error: null,
  notice: null,
  lastCursor: null,
  steps: {},
  stepOrder: [],
}

interface StepValue {
  readonly turn: number
  readonly step: number
  readonly value: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function stepValue(value: unknown): StepValue | undefined {
  if (!isRecord(value) || !Number.isSafeInteger(value.turn) || !Number.isSafeInteger(value.step)) return undefined
  return { turn: value.turn as number, step: value.step as number, value: value.value }
}

function visibleText(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block): block is { type: 'text'; text: string } => (
      isRecord(block) && block.type === 'text' && typeof block.text === 'string'
    ))
    .map(block => block.text)
    .join('')
}

function withStep(state: RequestProjection, key: string, text: string): RequestProjection {
  const stepOrder = state.stepOrder.includes(key) ? state.stepOrder : [...state.stepOrder, key]
  const steps = { ...state.steps, [key]: text }
  return { ...state, steps, stepOrder, answer: stepOrder.map(step => steps[step] ?? '').join('') }
}

function turnEnd(state: RequestProjection, value: unknown): RequestProjection {
  if (!isRecord(value) || !isRecord(value.reason) || typeof value.reason.kind !== 'string') {
    return { ...state, phase: 'error', error: 'Harness returned an invalid turn result.' }
  }
  switch (value.reason.kind) {
    case 'completed':
      return { ...state, phase: 'completed', error: null }
    case 'aborted':
      return { ...state, phase: 'cancelled', error: null }
    case 'max-tokens':
      return { ...state, phase: 'completed', notice: 'The answer reached the model output limit.' }
    case 'error': {
      const failure = isRecord(value.reason.error) && typeof value.reason.error.message === 'string'
        ? value.reason.error.message
        : 'Harness could not complete this request.'
      return { ...state, phase: 'error', error: failure }
    }
    case 'blocked':
      return { ...state, phase: 'error', error: 'Harness blocked this request.' }
    case 'interrupted':
      return { ...state, phase: 'error', error: 'Harness was interrupted before this request completed.' }
    default:
      return { ...state, phase: 'error', error: `Harness ended the request with an unsupported reason: ${value.reason.kind}.` }
  }
}

/** Projects one native session event for the active request without inferring missing identity. */
export function projectSessionEvent(
  state: RequestProjection,
  active: ActiveRequest,
  incoming: SessionAgentEvent,
): RequestProjection {
  if (incoming.sessionId !== active.sessionId) return state
  if (incoming.subscriptionId !== active.subscriptionId) return state
  if (incoming.error !== undefined) {
    return { ...state, phase: 'connection-lost', error: incoming.error }
  }
  if (incoming.requestId !== active.requestId || incoming.event === undefined) return state
  if (incoming.event.data.persistent && state.lastCursor !== null && incoming.event.data.cursor <= state.lastCursor) return state

  const next = incoming.event.data.persistent
    ? { ...state, lastCursor: incoming.event.data.cursor }
    : state
  switch (incoming.event.kind) {
    case 'assistant-delta': {
      const step = stepValue(incoming.event.data.value)
      if (step === undefined || !isRecord(step.value) || step.value.type !== 'text-delta' || typeof step.value.text !== 'string') return next
      const key = `${step.turn}:${step.step}`
      return { ...withStep(next, key, `${next.steps[key] ?? ''}${step.value.text}`), phase: 'streaming', error: null }
    }
    case 'assistant-complete': {
      const step = stepValue(incoming.event.data.value)
      if (step === undefined) return next
      const text = visibleText(step.value)
      return text === '' ? next : { ...withStep(next, `${step.turn}:${step.step}`, text), phase: 'streaming', error: null }
    }
    case 'tool-call':
    case 'tool-result':
      return { ...next, phase: 'streaming', error: null }
    case 'error':
      return { ...next, phase: 'error', error: 'Harness reported an agent error.' }
    case 'status': {
      const value = incoming.event.data.value
      if (isRecord(value) && value.status === 'queued') return { ...next, phase: 'queued', error: null }
      if (isRecord(value) && value.status === 'turn-end') return turnEnd(next, value)
      return next
    }
    default:
      return next
  }
}
