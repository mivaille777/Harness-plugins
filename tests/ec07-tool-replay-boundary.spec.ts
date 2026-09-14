import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  normalizeSelectionMaterial,
  resolveSelectionMaterialForCall,
} from '../src/session/material.js'

function material(snapshotId: string, text: string) {
  return normalizeSelectionMaterial({
    snapshotId,
    revision: snapshotId.endsWith('-b') ? 8 : 7,
    capturedAt: 7_000,
    selection: { text },
    source: { kind: 'browser', app: 'Chrome' },
    authorizedScope: 'selection',
    actualScope: 'selection',
    completeness: 'complete',
  })
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}

describe('EC-07B replay boundary', () => {
  it('ignores pre-turn inbox material and binds the tool call to the admitted user/message', () => {
    const pendingA = material('snapshot-ec07-a', 'PENDING_A_MUST_NOT_BIND')
    const admittedB = material('snapshot-ec07-b', 'ADMITTED_B_MUST_BIND')
    const events = [
      event(1, 'agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [{
          id: 'message-a',
          role: 'user',
          content: [{ type: 'text', text: 'pending request A' }],
          source: { kind: 'selection-companion', requestId: 'request-a', material: pendingA },
        }],
      }),
      event(2, 'turn/start', { turn: 3 }),
      event(3, 'user/message', {
        id: 'message-b',
        role: 'user',
        content: [{ type: 'text', text: 'admitted request B' }],
        source: { kind: 'selection-companion', requestId: 'request-b', material: admittedB },
      }),
      event(4, 'tool/call', {
        turn: 3,
        step: 1,
        callId: 'call-ec07b',
        name: 'selection_read_context',
        arguments: '{"scope":"selection"}',
      }),
    ]

    const bound = resolveSelectionMaterialForCall(events, 'call-ec07b')
    expect(bound.requestId).toBe('request-b')
    expect(bound.material.snapshotId).toBe('snapshot-ec07-b')
    expect(bound.material.selection.text).toBe('ADMITTED_B_MUST_BIND')
    expect(JSON.stringify(bound)).not.toContain('PENDING_A_MUST_NOT_BIND')
  })

  it('fails closed when only an inbox receipt exists and no admitted user/message belongs to the turn', () => {
    const pending = material('snapshot-ec07-a', 'PENDING_ONLY_MUST_NOT_BIND')
    const events = [
      event(1, 'agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [{
          id: 'message-a',
          role: 'user',
          content: [{ type: 'text', text: 'pending only' }],
          source: { kind: 'selection-companion', requestId: 'request-a', material: pending },
        }],
      }),
      event(2, 'turn/start', { turn: 4 }),
      event(3, 'tool/call', {
        turn: 4,
        step: 1,
        callId: 'call-ec07b-missing',
        name: 'selection_read_context',
        arguments: '{"scope":"selection"}',
      }),
    ]

    expect(() => resolveSelectionMaterialForCall(events, 'call-ec07b-missing'))
      .toThrow('no persisted selection material in turn 4')
  })
})
