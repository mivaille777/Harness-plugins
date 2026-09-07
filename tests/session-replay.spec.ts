import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RequestTurnTracker } from '../src/session/service.js'

const recordedSession = [
  { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'Selected material:\n\nA fixed source excerpt.\n\nExplain it.' }], source: { kind: 'plugin', plugin: 'selection-companion' } } },
  { type: 'assistant/message', data: { role: 'assistant', content: [{ type: 'text', text: 'Recorded answer.' }] } },
] as const

describe('selection companion session replay fixture', () => {
  it('keeps the complete model-visible selection prompt in the durable user-message event', () => {
    const input = recordedSession.find(event => event.type === 'user/message')?.data
    expect(input).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Selected material:\n\nA fixed source excerpt.\n\nExplain it.' }],
      source: { kind: 'plugin', plugin: 'selection-companion' },
    })
  })

  it('correlates output only through durable selection messages and turn numbers', () => {
    const tracker = new RequestTurnTracker()
    const event = (seq: number, type: string, data: unknown): SessionEvent => (
      { seq, time: seq, type, data } as SessionEvent
    )

    tracker.project(event(1, 'turn/start', { turn: 4 }))
    expect(tracker.project(event(2, 'user/message', {
      id: 'message-4', role: 'user', content: [], source: { kind: 'selection-companion', requestId: 'request-4' },
    }))).toEqual({
      cursor: 2,
      requestId: 'request-4',
      kind: 'status',
      data: { status: 'queued', turn: 4 },
    })
    expect(tracker.project(event(3, 'assistant/chunk', { turn: 4, step: 1, chunk: { type: 'text-delta', index: 0, text: 'first' } })))
      .toEqual({
        cursor: 3,
        requestId: 'request-4',
        kind: 'assistant-delta',
        data: { turn: 4, step: 1, value: { type: 'text-delta', index: 0, text: 'first' } },
      })
    expect(tracker.project(event(4, 'turn/end', { turn: 4, reason: { kind: 'completed' } })))
      .toEqual({
        cursor: 4,
        requestId: 'request-4',
        kind: 'status',
        data: { status: 'turn-end', turn: 4, reason: { kind: 'completed' } },
      })

    expect(tracker.project(event(5, 'assistant/chunk', { turn: 4, step: 1, chunk: { type: 'text-delta', index: 0, text: 'late' } })))
      .not.toHaveProperty('requestId')

    tracker.project(event(6, 'turn/start', { turn: 5 }))
    tracker.project(event(7, 'user/message', {
      id: 'message-5', role: 'user', content: [], source: { kind: 'selection-companion', requestId: 'request-5' },
    }))
    expect(tracker.project(event(8, 'assistant/message', { turn: 5, step: 1, message: { id: 'answer-5' } })))
      .toEqual({
        cursor: 8,
        requestId: 'request-5',
        kind: 'assistant-complete',
        data: { turn: 5, step: 1, value: { id: 'answer-5' } },
      })
  })
})
