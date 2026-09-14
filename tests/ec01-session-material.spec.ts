import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  normalizeSelectionMaterial,
  resolveSelectionMaterialForCall,
} from '../src/session/material.js'

function expandedMaterial() {
  return {
    snapshotId: 'snapshot-ec01',
    revision: 4,
    capturedAt: 1_700_000_000_000,
    selection: { text: 'EC01 fixed selection.' },
    source: { kind: 'browser', app: 'Chrome' },
    document: { title: 'EC01 fixture', url: 'https://example.test/ec01' },
    authorizedScope: 'local',
    actualScope: 'local',
    completeness: 'complete',
    truncated: false,
    context: {
      before: 'EC01_LOCAL_BEFORE_SENTINEL',
      after: 'EC01_LOCAL_AFTER_SENTINEL',
    },
  }
}

function durableEvents(material: unknown): SessionEvent[] {
  return [
    {
      seq: 1,
      time: 1,
      type: 'turn/start',
      data: { turn: 1 },
    } as SessionEvent,
    {
      seq: 2,
      time: 2,
      surfaceOp: 'append',
      type: 'user/message',
      data: {
        id: 'message-ec01',
        role: 'user',
        content: [{ type: 'text', text: 'Use my authorized context.' }],
        source: {
          kind: 'selection-companion',
          requestId: 'request-ec01',
          material,
        },
      },
    } as SessionEvent,
    {
      seq: 3,
      time: 3,
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'call-ec01',
        name: 'selection_read_context',
        arguments: '{"scope":"local"}',
      },
    } as SessionEvent,
  ]
}

describe('EC-01 durable expanded-material baseline', () => {
  it('accepts a canonical local material after the EC-02 schema migration', () => {
    expect(normalizeSelectionMaterial(expandedMaterial())).toMatchObject({
      authorizedScope: 'local',
      actualScope: 'local',
      context: {
        before: 'EC01_LOCAL_BEFORE_SENTINEL',
        after: 'EC01_LOCAL_AFTER_SENTINEL',
      },
    })
  })

  it('reconstructs explicitly authorized local context from the durable turn', () => {
    const bound = resolveSelectionMaterialForCall(durableEvents(expandedMaterial()), 'call-ec01')
    expect(bound).toMatchObject({
      requestId: 'request-ec01',
      material: {
        snapshotId: 'snapshot-ec01',
        revision: 4,
        authorizedScope: 'local',
        actualScope: 'local',
        completeness: 'complete',
        truncated: false,
        context: {
          before: 'EC01_LOCAL_BEFORE_SENTINEL',
          after: 'EC01_LOCAL_AFTER_SENTINEL',
        },
      },
    })
  })
})
