import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
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
  const sessions = {
    list: async () => [],
    create: async () => 'session-created',
    submit: async () => undefined,
    cancel: () => true,
    subscribe: async () => ({ dispose: () => undefined }),
  }
  const router = new BridgeMessageRouter(ctx.selectionContext, sessions, {
    pluginVersion: '0.1.0-test',
    now: () => now,
  })
  return { ctx, router }
}

function selectionUpdate() {
  return parseIpcMessage({
    protocol: 1,
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
  it('negotiates Protocol V1 and advertises session capabilities', async () => {
    const { router } = setup()
    const response = await router.handle(parseIpcMessage({
      protocol: 1,
      id: 'hello-1',
      type: 'bridge.hello',
      payload: {
        client: { name: 'native-test', version: '0.1.0', platform: 'windows' },
        supportedProtocols: [1],
      },
    }))

    expect(response.type).toBe('bridge.hello.result')
    if (response.type !== 'bridge.hello.result') throw new Error('unexpected response')
    expect(response.payload.protocol).toBe(1)
    expect(response.payload.server.version).toBe('0.1.0-test')
    expect(response.payload.capabilities).toEqual(BRIDGE_CAPABILITIES)
  })

  it('returns a deterministic pong', async () => {
    const { router } = setup(99_999)
    const response = await router.handle(parseIpcMessage({
      protocol: 1,
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
      protocol: 1,
      id: 'current-1',
      type: 'selection.current',
      payload: {},
    }))

    expect(response.type).toBe('selection.current.result')
    if (response.type !== 'selection.current.result') throw new Error('unexpected response')
    expect(response.payload.snapshot?.id).toBe('selection-1')
    expect(Object.isFrozen(response.payload.snapshot)).toBe(true)
  })

  it('fails closed for Protocol V1 operations that remain unavailable', async () => {
    const { router } = setup()
    const response = await router.handle(parseIpcMessage({
      protocol: 1,
      id: 'session-list-1',
      type: 'selection.expand',
      payload: { snapshotId: 'snapshot-1', scope: 'page' },
    }))

    expect(response.type).toBe('error.response')
    if (response.type !== 'error.response') throw new Error('unexpected response')
    expect(response.payload.code).toBe('BRIDGE_UNAVAILABLE')
  })
})
