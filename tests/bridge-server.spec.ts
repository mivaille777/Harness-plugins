import { Context } from '@deepseek-ai/cordis'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  BRIDGE_CAPABILITIES,
  BridgeMessageRouter,
  DEFAULT_BRIDGE_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_BRIDGE_CLIENTS,
  SelectionCompanionBridgeService,
  SelectionContextService,
  parseIpcMessage,
} from '../src/index.js'

function setup(now = 42_000) {
  const ctx = new Context()
  new SelectionContextService(ctx)
  const submit = vi.fn(async (..._args: unknown[]) => ({ requestId: 'request-test', messageId: 'message-test', delivery: 'queued' as const, duplicate: false }))
  const sessions = {
    list: async () => [],
    create: async () => 'session-created',
    submit,
    cancel: () => true,
    subscribe: async () => ({ dispose: () => undefined }),
  }
  const router = new BridgeMessageRouter(ctx.selectionContext, sessions, {
    pluginVersion: '0.1.0-test',
    now: () => now,
  })
  return { ctx, router, submit }
}

function selectionUpdate() {
  return parseIpcMessage({
    protocol: 3,
    id: 'selection-update-1',
    type: 'selection.update',
    payload: {
      snapshot: {
        id: 'selection-1',
        revision: 1,
        capturedAt: 1_000,
        selection: { text: 'DeepSeek Harness selection context' },
        source: { kind: 'browser', app: 'Chrome' },
        context: {
          before: 'Before.',
          after: 'After.',
          pageAvailable: true,
        },
        capabilities: {
          localContext: true,
          sectionContext: false,
          pageContext: true,
          screenshot: false,
        },
        provider: 'browser-dom',
        confidence: 0.99,
      },
    },
  })
}

function selectionMaterial() {
  return {
    snapshotId: 'selection-1',
    revision: 1,
    capturedAt: 1_000,
    selection: { text: 'DeepSeek Harness selection context' },
    source: { kind: 'browser', app: 'Chrome' },
    authorizedScope: 'selection' as const,
    actualScope: 'selection' as const,
    completeness: 'complete' as const,
  }
}

describe('BridgeMessageRouter', () => {
  it('exposes bounded server defaults', () => {
    expect(DEFAULT_BRIDGE_IDLE_TIMEOUT_MS).toBe(30_000)
    expect(DEFAULT_MAX_BRIDGE_CLIENTS).toBe(4)
    const idleContext = new Context()
    new SelectionContextService(idleContext)
    expect(() => new SelectionCompanionBridgeService(idleContext, { idleTimeoutMs: 0 })).toThrow('positive')
    const clientContext = new Context()
    new SelectionContextService(clientContext)
    expect(() => new SelectionCompanionBridgeService(clientContext, { maxClients: 0 })).toThrow('positive')
  })
  it('negotiates Protocol V3 and advertises session capabilities', async () => {
    const { router } = setup()
    const response = await router.handle(parseIpcMessage({
      protocol: 3,
      id: 'hello-1',
      type: 'bridge.hello',
      payload: {
        client: { name: 'native-test', version: '0.1.0', platform: 'windows' },
        supportedProtocols: [3],
      },
    }))

    expect(response.type).toBe('bridge.hello.result')
    if (response.type !== 'bridge.hello.result') throw new Error('unexpected response')
    expect(response.payload.protocol).toBe(3)
    expect(response.payload.server.version).toBe('0.1.0-test')
    expect(response.payload.capabilities).toEqual(BRIDGE_CAPABILITIES)
  })

  it('returns a deterministic pong', async () => {
    const { router } = setup(99_999)
    const response = await router.handle(parseIpcMessage({
      protocol: 3,
      id: 'ping-1',
      type: 'bridge.ping',
      payload: { sentAt: 12_345 },
    }))

    expect(response).toMatchObject({
      id: 'ping-1',
      type: 'bridge.pong',
      payload: { sentAt: 12_345, receivedAt: 99_999 },
    })
  })

  it('routes selection.update through ctx.selectionContext', async () => {
    const { ctx, router } = setup()
    const response = await router.handle(selectionUpdate())

    expect(response.type).toBe('selection.updated')
    expect(ctx.selectionContext.current()?.id).toBe('selection-1')
    expect(ctx.selectionContext.current()?.selection.text).toBe('DeepSeek Harness selection context')
  })

  it('returns the current immutable selection through the bridge', async () => {
    const { router } = setup()
    await router.handle(selectionUpdate())
    const response = await router.handle(parseIpcMessage({
      protocol: 3,
      id: 'current-1',
      type: 'selection.current',
      payload: {},
    }))

    expect(response.type).toBe('selection.current.result')
    if (response.type !== 'selection.current.result') throw new Error('unexpected response')
    expect(response.payload.snapshot?.id).toBe('selection-1')
    expect(Object.isFrozen(response.payload.snapshot)).toBe(true)
  })

  it('returns the durable message receipt for a submitted request', async () => {
    const { router } = setup()
    const response = await router.handle(parseIpcMessage({
      protocol: 3,
      id: 'submit-transport-1',
      type: 'session.submit',
      payload: {
        sessionId: 'session-1',
        requestId: 'request-test',
        mode: 'queue',
        content: [{ type: 'text', text: 'Explain the fixed material.' }],
        material: selectionMaterial(),
      },
    }))
    expect(response).toEqual({
      protocol: 3,
      id: 'submit-transport-1',
      type: 'session.submitted',
      payload: {
        accepted: true,
        requestId: 'request-test',
        messageId: 'message-test',
        delivery: 'queued',
        duplicate: false,
      },
    })
  })

  it('normalizes Rust null optional material before routing the durable submission', async () => {
    const { router, submit } = setup()

    await router.handle(parseIpcMessage({
      protocol: 3,
      id: 'submit-rust-null-material',
      type: 'session.submit',
      payload: {
        sessionId: 'session-1',
        requestId: 'request-rust-null',
        mode: 'queue',
        content: [{ type: 'text', text: 'Explain this fixed material.' }],
        material: {
          snapshotId: 'snapshot-rust-null',
          revision: 1,
          capturedAt: 1_000,
          selection: { text: 'Fixed native material.', language: null },
          source: { kind: 'desktop', app: null, process: null, windowTitle: null },
          document: null,
          authorizedScope: 'selection',
          actualScope: 'selection',
          completeness: 'complete',
        },
      },
    }))

    const material = submit.mock.calls[0]?.[4]
    expect(snapshotJsonValue(material)).toEqual(material)
    expect(material).toEqual({
      snapshotId: 'snapshot-rust-null',
      revision: 1,
      capturedAt: 1_000,
      selection: { text: 'Fixed native material.' },
      source: { kind: 'desktop' },
      authorizedScope: 'selection',
      actualScope: 'selection',
      completeness: 'complete',
    })
  })

  it('fails closed for Protocol V3 operations that remain unavailable', async () => {
    const { router } = setup()
    const response = await router.handle(parseIpcMessage({
      protocol: 3,
      id: 'session-list-1',
      type: 'selection.expand',
      payload: { snapshotId: 'snapshot-1', scope: 'page' },
    }))

    expect(response.type).toBe('error.response')
    if (response.type !== 'error.response') throw new Error('unexpected response')
    expect(response.payload.code).toBe('BRIDGE_UNAVAILABLE')
  })
})
