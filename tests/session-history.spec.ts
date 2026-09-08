import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage, createUserMessage, type CallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { projectSessionHistory, sessionHistoryCursor } from '../src/session/history.js'
import { normalizeSelectionMaterial } from '../src/session/material.js'

function selectionMaterial() {
  return normalizeSelectionMaterial({
    snapshotId: 'snapshot-history',
    revision: 1,
    capturedAt: 1_000,
    selection: { text: 'Fixed selection material.' },
    source: { kind: 'browser' },
    authorizedScope: 'selection',
    actualScope: 'selection',
    completeness: 'complete',
  })
}

function sessionWithVisibleMessages(): Session {
  const session = Session.create(SessionId('history-projection'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Explain the fixed selection.' }],
    source: {
      kind: 'selection-companion',
      requestId: 'request-history',
      deliveryMode: 'queue',
      contentDigest: '0'.repeat(64),
      material: selectionMaterial(),
    },
  }), { surfaceOp: 'append' })
  session.append('assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'text-delta', index: 0, text: 'partial response' },
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [
        { type: 'reasoning', text: 'Hidden reasoning.' },
        { type: 'text', text: 'Durable ' },
        { type: 'text', text: 'answer.' },
      ],
      source: { provider: 'fixture', model: 'fixture-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: 'history-tool-call' as CallId,
      content: [{ type: 'text', text: 'Tool-only context.' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

describe('projectSessionHistory', () => {
  it('projects append-origin user and durable assistant text with source identity', () => {
    const session = sessionWithVisibleMessages()

    expect(projectSessionHistory(session.events)).toEqual([
      {
        seq: 1,
        time: session.events[1]?.time,
        role: 'user',
        text: 'Explain the fixed selection.',
        sourceKind: 'selection-companion',
        requestId: 'request-history',
      },
      {
        seq: 3,
        time: session.events[3]?.time,
        role: 'assistant',
        text: 'Durable answer.',
        sourceKind: 'model',
      },
    ])
  })

  it('excludes chunks, tool results, empty assistant messages, and compacted replacements', () => {
    const session = sessionWithVisibleMessages()
    const originalUser = session.events[1]!
    if (originalUser.type !== 'user/message') throw new Error('fixture user event was not appended')
    session.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [],
        source: { provider: 'fixture', model: 'fixture-model' },
      }),
    }, { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Compacted replacement.' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: originalUser.seq, end: originalUser.seq },
      sourceEventSeqs: [originalUser.seq],
    })

    expect(projectSessionHistory(session.events).map(entry => entry.text)).toEqual([
      'Explain the fixed selection.',
      'Durable answer.',
    ])
  })

  it('leaves its durable input untouched and exposes the raw high-water cursor', () => {
    const session = sessionWithVisibleMessages()
    const events = [...session.events] as SessionEvent[]
    const before = structuredClone(events)

    projectSessionHistory(events)

    expect(events).toEqual(before)
    expect(sessionHistoryCursor(events)).toBe(events.at(-1)?.seq)
    expect(sessionHistoryCursor([])).toBeUndefined()
  })
})
