import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  IPC_MAX_FRAME_BYTES,
  IPC_PROTOCOL_VERSION,
  IpcFrameDecoder,
  IpcProtocolError,
  PendingRequestTracker,
  decodeIpcFrame,
  encodeIpcFrame,
  parseIpcMessage,
  type IpcMessage,
} from '../src/index.js'

const fixtureDir = fileURLToPath(new URL('./protocol/', import.meta.url))
const invalidFixtureDir = fileURLToPath(new URL('./protocol/invalid/', import.meta.url))

const ping: IpcMessage = {
  protocol: IPC_PROTOCOL_VERSION,
  id: 'ping-1',
  type: 'bridge.ping',
  payload: { sentAt: 1_000 },
}

describe('IPC golden fixtures', () => {
  it('accepts every shared JSON fixture on the TypeScript side', async () => {
    const files = (await readdir(fixtureDir))
      .filter(file => file.endsWith('.json'))
      .sort()
    expect(files.length).toBeGreaterThanOrEqual(6)

    for (const file of files) {
      const source = await readFile(new URL(`./protocol/${file}`, import.meta.url), 'utf8')
      expect(() => parseIpcMessage(source), file).not.toThrow()
    }
  })

  it('rejects every shared invalid JSON fixture on the TypeScript side', async () => {
    const files = (await readdir(invalidFixtureDir)).filter(file => file.endsWith('.json')).sort()
    expect(files.length).toBeGreaterThanOrEqual(5)

    for (const file of files) {
      const source = await readFile(new URL(`./protocol/invalid/${file}`, import.meta.url), 'utf8')
      expect(() => parseIpcMessage(source), file).toThrow(IpcProtocolError)
    }
  })
})

describe('IPC message validation', () => {
  it('rejects malformed JSON', () => {
    expect(() => parseIpcMessage('{not-json')).toThrow(IpcProtocolError)
    try {
      parseIpcMessage('{not-json')
    } catch (error) {
      expect((error as IpcProtocolError).code).toBe('INVALID_JSON')
    }
  })

  it('rejects protocol mismatch before dispatch', () => {
    expect(() => parseIpcMessage({
      protocol: 1,
      id: 'hello-2',
      type: 'bridge.ping',
      payload: { sentAt: 1 },
    })).toThrow('unsupported IPC protocol 1; expected 4')
  })

  it('rejects unknown message types', () => {
    try {
      parseIpcMessage({
        protocol: IPC_PROTOCOL_VERSION,
        id: 'unknown-1',
        type: 'unknown.method',
        payload: {},
      })
      throw new Error('expected unknown message type to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(IpcProtocolError)
      expect((error as IpcProtocolError).code).toBe('UNKNOWN_MESSAGE_TYPE')
    }
  })

  it('rejects unknown selection fields at the IPC boundary', () => {
    expect(() => parseIpcMessage({
      protocol: IPC_PROTOCOL_VERSION,
      id: 'selection-1',
      type: 'selection.update',
      payload: {
        snapshot: {
          id: 'snapshot-1',
          revision: 1,
          capturedAt: 10,
          selection: { text: '  多模态 context 🚀  ' },
          source: { kind: 'browser' },
          context: { pageAvailable: false },
          capabilities: {
            localContext: true,
            sectionContext: false,
            pageContext: false,
            screenshot: false,
          },
          provider: 'browser-dom',
          confidence: 1,
          ignoredWireField: 'discard me',
        },
      },
    })).toThrow(IpcProtocolError)
  })

  it('bounds history pages before a request reaches the session service', () => {
    expect(() => parseIpcMessage({
      protocol: IPC_PROTOCOL_VERSION,
      id: 'history-limit-1',
      type: 'session.history',
      payload: { sessionId: 'session-1', limit: 33 },
    })).toThrow(IpcProtocolError)
  })

  it('normalizes Rust null spellings for absent material fields before durable storage', () => {
    const parsed = parseIpcMessage({
      protocol: IPC_PROTOCOL_VERSION,
      id: 'submit-rust-optional-fields',
      type: 'session.submit',
      payload: {
        sessionId: 'session-1',
        requestId: 'request-1',
        mode: 'queue',
        content: [{ type: 'text', text: 'Explain this fixed selection.' }],
        material: {
          ...selectionMaterialFixture(),
          selection: { text: 'Protocol fixture selection.', language: null },
          source: { kind: 'browser', app: null, process: null, windowTitle: null },
          document: null,
        },
      },
    })

    if (parsed.type !== 'session.submit') throw new Error('expected session.submit message')
    expect(parsed.payload.material).toEqual({
      snapshotId: 'snapshot-protocol',
      revision: 1,
      capturedAt: 1_000,
      selection: { text: 'Protocol fixture selection.' },
      source: { kind: 'browser' },
      authorizedScope: 'selection',
      actualScope: 'selection',
      completeness: 'complete',
    })
  })

  it('accepts a bounded selection expansion response with its snapshot revision', () => {
    const parsed = parseIpcMessage({
      protocol: IPC_PROTOCOL_VERSION,
      id: 'selection-expand-response-1',
      type: 'selection.expanded',
      payload: {
        snapshotId: 'selection-1',
        scope: 'page',
        revision: 9,
        completeness: 'partial',
        truncated: true,
        context: { pageText: 'Captured page context.' },
      },
    })

    expect(parsed).toMatchObject({
      type: 'selection.expanded',
      payload: {
        snapshotId: 'selection-1',
        scope: 'page',
        revision: 9,
        completeness: 'partial',
        truncated: true,
        context: { pageText: 'Captured page context.' },
      },
    })
  })

  it('rejects V3 expanded material rather than silently interpreting it as V4', () => {
    expect(() => parseIpcMessage({
      protocol: 3,
      id: 'legacy-expanded-submit',
      type: 'session.submit',
      payload: {
        sessionId: 'session-1',
        requestId: 'request-legacy',
        mode: 'queue',
        content: [{ type: 'text', text: 'Explain.' }],
        material: {
          ...selectionMaterialFixture(),
          authorizedScope: 'page',
          actualScope: 'page',
          completeness: 'complete',
          truncated: false,
          context: { pageText: 'Legacy page text.' },
        },
      },
    })).toThrow('unsupported IPC protocol 3; expected 4')
  })
})

describe('IPC length-prefixed framing', () => {
  it('round-trips one complete frame', () => {
    const frame = encodeIpcFrame(ping)
    expect(frame.readUInt32BE(0)).toBe(frame.byteLength - 4)
    expect(decodeIpcFrame(frame)).toEqual(ping)
  })

  it('supports partial chunks and multiple frames on one byte stream', () => {
    const first = encodeIpcFrame(ping)
    const second = encodeIpcFrame({ ...ping, id: 'ping-2', payload: { sentAt: 2_000 } })
    const decoder = new IpcFrameDecoder()

    expect(decoder.push(first.subarray(0, 3))).toEqual([])
    const messages = decoder.push(Buffer.concat([first.subarray(3), second]))
    expect(messages.map(message => message.id)).toEqual(['ping-1', 'ping-2'])
    expect(decoder.bufferedBytes).toBe(0)
  })

  it('rejects a truncated frame', () => {
    const frame = encodeIpcFrame(ping)
    expect(() => decodeIpcFrame(frame.subarray(0, frame.byteLength - 1)))
      .toThrow('declares')
  })

  it('rejects payloads larger than the v4 one-megabyte limit', () => {
    const oversized: IpcMessage = {
      protocol: IPC_PROTOCOL_VERSION,
      id: 'large-1',
      type: 'session.submit',
      payload: {
        sessionId: 'session-1',
        requestId: 'request-1',
        mode: 'queue',
        content: [{ type: 'text', text: 'x'.repeat(IPC_MAX_FRAME_BYTES) }],
        material: selectionMaterialFixture(),
      },
    }

    expect(() => encodeIpcFrame(oversized)).toThrow(IpcProtocolError)
  })
})

function selectionMaterialFixture() {
  return {
    snapshotId: 'snapshot-protocol',
    revision: 1,
    capturedAt: 1_000,
    selection: { text: 'Protocol fixture selection.' },
    source: { kind: 'browser' as const, app: 'Chrome' },
    authorizedScope: 'selection' as const,
    actualScope: 'selection' as const,
    completeness: 'complete' as const,
  }
}

describe('pending request lifecycle', () => {
  it('rejects duplicate ids, expires timed-out requests, and resets after reconnect/restart', () => {
    let now = 1_000
    const tracker = new PendingRequestTracker({ timeoutMs: 100, now: () => now })

    tracker.begin('req-1')
    expect(() => tracker.begin('req-1')).toThrow('already pending')
    now = 1_099
    expect(tracker.expire()).toEqual([])
    now = 1_100
    expect(tracker.expire()).toEqual(['req-1'])

    tracker.begin('req-2')
    tracker.begin('req-3')
    expect(tracker.reset()).toEqual(['req-2', 'req-3'])
    expect(tracker.size).toBe(0)
  })
})
