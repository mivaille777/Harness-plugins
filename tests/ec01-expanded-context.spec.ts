import { describe, expect, it } from 'vitest'
import {
  IPC_PROTOCOL_VERSION,
  IpcProtocolError,
  parseIpcMessage,
} from '../src/index.js'

function expandedSubmitMessage(protocol: number = IPC_PROTOCOL_VERSION) {
  return {
    protocol,
    id: 'ec01-expanded-submit',
    type: 'session.submit',
    payload: {
      sessionId: 'session-ec01',
      requestId: 'request-ec01',
      mode: 'queue',
      content: [{ type: 'text', text: 'Explain using explicitly authorized local context.' }],
      material: {
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
      },
    },
  }
}

describe('EC-01 expanded-context protocol baseline', () => {
  it('pins Protocol V4 and rejects the same expanded request when labeled as V3', () => {
    expect(IPC_PROTOCOL_VERSION).toBe(4)
    expect(() => parseIpcMessage(expandedSubmitMessage(3))).toThrow(IpcProtocolError)
  })

  it('accepts an explicitly authorized expanded material at the V4 session boundary', () => {
    const parsed = parseIpcMessage(expandedSubmitMessage())
    expect(parsed).toMatchObject({
      type: 'session.submit',
      payload: {
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
      },
    })
  })
})
