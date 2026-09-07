import { describe, expect, it } from 'vitest'
import type { SessionAgentEvent } from './api/bridge'
import { initialRequestProjection, projectSessionEvent, type RequestProjection } from './sessionProjection'

const active = { sessionId: 'session-1', requestId: 'request-1', subscriptionId: 'subscription-1' }

function event(
  cursor: number,
  kind: NonNullable<SessionAgentEvent['event']>['kind'],
  value: unknown,
  overrides: Partial<SessionAgentEvent> = {},
): SessionAgentEvent {
  return {
    sessionId: 'session-1',
    subscriptionId: 'subscription-1',
    requestId: 'request-1',
    event: { kind, data: { cursor, persistent: true, value } },
    ...overrides,
  }
}

function reduce(events: readonly SessionAgentEvent[]): RequestProjection {
  return events.reduce(
    (state, incoming) => projectSessionEvent(state, active, incoming),
    initialRequestProjection,
  )
}

describe('projectSessionEvent', () => {
  it('renders text deltas and excludes reasoning and tool argument streams', () => {
    const state = reduce([
      event(1, 'assistant-delta', { turn: 1, step: 1, value: { type: 'reasoning-delta', index: 0, text: 'hidden' } }),
      event(2, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 1, text: 'Visible ' } }),
      event(3, 'assistant-delta', { turn: 1, step: 1, value: { type: 'tool-call-delta', index: 2, argumentsDelta: '{"secret":' } }),
      event(4, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 1, text: 'answer' } }),
    ])

    expect(state.answer).toBe('Visible answer')
    expect(state.phase).toBe('streaming')
  })

  it('uses complete messages to calibrate steps without completing the turn', () => {
    const state = reduce([
      event(1, 'assistant-delta', { turn: 2, step: 1, value: { type: 'text-delta', index: 0, text: 'Partial' } }),
      event(2, 'assistant-complete', {
        turn: 2,
        step: 1,
        value: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'First step. ' }, { type: 'tool-call', name: 'lookup' }] },
      }),
      event(3, 'tool-result', { turn: 2, step: 1, value: { callId: 'call-1' } }),
      event(4, 'assistant-complete', {
        turn: 2,
        step: 2,
        value: { content: [{ type: 'text', text: 'Final answer.' }] },
      }),
    ])

    expect(state.answer).toBe('First step. Final answer.')
    expect(state.phase).toBe('streaming')
  })

  it('restores visible text from a complete message when no deltas were replayed', () => {
    const state = reduce([event(9, 'assistant-complete', {
      turn: 3,
      step: 1,
      value: { content: [{ type: 'text', text: 'Recovered answer.' }] },
    })])

    expect(state.answer).toBe('Recovered answer.')
    expect(state.lastCursor).toBe(9)
  })

  it.each([
    ['completed', { kind: 'completed' }, 'completed'],
    ['cancelled', { kind: 'aborted', reason: { kind: 'user' } }, 'cancelled'],
    ['blocked', { kind: 'blocked' }, 'error'],
    ['interrupted', { kind: 'interrupted' }, 'error'],
  ] as const)('maps a %s turn end to %s', (_label, reason, phase) => {
    const state = reduce([event(12, 'status', { status: 'turn-end', turn: 4, reason })])
    expect(state.phase).toBe(phase)
  })

  it('reports structured model errors and max-token completion separately', () => {
    const failed = reduce([event(1, 'status', {
      status: 'turn-end', turn: 1, reason: { kind: 'error', error: { code: 'UPSTREAM', message: 'Provider unavailable' } },
    })])
    expect(failed).toMatchObject({ phase: 'error', error: 'Provider unavailable' })

    const limited = reduce([event(1, 'status', { status: 'turn-end', turn: 1, reason: { kind: 'max-tokens' } })])
    expect(limited).toMatchObject({ phase: 'completed', notice: 'The answer reached the model output limit.' })
  })

  it('ignores stale cursors and another request or session', () => {
    const state = reduce([
      event(5, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'A' } }),
      event(5, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'duplicate' } }),
      event(6, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'wrong request' } }, { requestId: 'request-2' }),
      event(7, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'wrong session' } }, { sessionId: 'session-2' }),
      event(8, 'assistant-delta', { turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'old subscription' } }, { subscriptionId: 'subscription-0' }),
    ])
    expect(state.answer).toBe('A')
    expect(state.lastCursor).toBe(5)
  })

  it('surfaces a session connection failure without a request id', () => {
    const state = projectSessionEvent(initialRequestProjection, active, {
      sessionId: 'session-1',
      subscriptionId: 'subscription-1',
      error: 'named pipe closed',
    })
    expect(state).toMatchObject({ phase: 'connection-lost', error: 'named pipe closed' })
  })

  it('does not advance the durable cursor for transient status', () => {
    const durable = reduce([event(4, 'assistant-delta', {
      turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'A' },
    })])
    const transient = projectSessionEvent(durable, active, event(99, 'status', { status: 'running' }, {
      event: { kind: 'status', data: { cursor: 99, persistent: false, value: { status: 'running' } } },
    }))
    expect(transient.lastCursor).toBe(4)
  })

  it('accepts output from a shared turn containing the active request', () => {
    const state = reduce([event(1, 'assistant-delta', {
      turn: 5, step: 1, value: { type: 'text-delta', index: 0, text: 'shared answer' },
    }, { requestId: undefined, requestIds: ['request-0', 'request-1'] })])
    expect(state.answer).toBe('shared answer')
  })

  it('keeps a cancellation terminal when a late token arrives', () => {
    const state = reduce([
      event(1, 'status', { status: 'turn-end', turn: 1, reason: { kind: 'aborted', cause: { kind: 'user' } } }),
      event(2, 'assistant-delta', {
        turn: 1, step: 1, value: { type: 'text-delta', index: 0, text: 'late' },
      }),
    ])
    expect(state).toMatchObject({ phase: 'cancelled', answer: '', lastCursor: 2 })
  })
})
