import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SelectionCompanionSessionService } from '../src/session/service.js'

function setup(now: number | (() => number) = 10_000, initialEvents: SessionEvent[] = []) {
  const ctx = new Context()
  const runtime = ctx as unknown as Record<string, unknown>
  const agents = new Map<string, Record<string, unknown>>()
  const followup = vi.fn()
  const steer = vi.fn()
  const cancel = vi.fn()
  const makeAgent = (id: string) => ({
    id: SessionId(id), status: 'idle', session: { events: initialEvents }, followup, steer, cancel,
  })
  runtime.agents = {
    get: (id: string) => agents.get(id),
    create: vi.fn(async (options: { sessionId: string }) => {
      const agent = makeAgent(options.sessionId)
      agents.set(options.sessionId, agent)
      return { agent, dispose: async () => { agents.delete(options.sessionId) } }
    }),
    resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
      const agent = makeAgent(resumeSessionId)
      agents.set(resumeSessionId, agent)
      return { agent, dispose: async () => { agents.delete(resumeSessionId) } }
    }),
  }
  runtime.agentDefaultModel = { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
  runtime.sessionQuery = {
    listSessions: async () => [{ header: { id: SessionId('persisted-session') } }],
    readSession: async (id: string) => ({ header: { id }, events: [] }),
  }
  const service = new SelectionCompanionSessionService(ctx, {
    now: typeof now === 'function' ? now : () => now,
    submissionRetentionMs: 100,
  })
  return { ctx, agents, followup, steer, cancel, service }
}

describe('SelectionCompanionSessionService', () => {
  it('creates an ordinary Harness agent and lists persisted sessions', async () => {
    const { service } = setup()
    await expect(service.list()).resolves.toEqual([{ id: 'persisted-session', status: 'unknown' }])
    const id = await service.create('D:/fixture')
    expect(id).toMatch(/^selection-companion-/)
  })

  it('records one normal Harness user message and deduplicates the same request', async () => {
    const { service, followup } = setup()
    const sessionId = await service.create()
    const first = await service.submit(sessionId, 'request-1', 'queue', [{ type: 'text', text: 'Explain this fixed selection.' }])
    const duplicate = await service.submit(sessionId, 'request-1', 'queue', [{ type: 'text', text: 'Explain this fixed selection.' }])
    expect(followup).toHaveBeenCalledTimes(1)
    expect(duplicate).toEqual(first)
    expect(followup.mock.calls[0]?.[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Explain this fixed selection.' }],
      source: {
        kind: 'selection-companion',
        requestId: 'request-1',
        deliveryMode: 'queue',
        contentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    await expect(service.submit(sessionId, 'request-1', 'queue', [{ type: 'text', text: 'must conflict' }]))
      .rejects.toThrow('different content or delivery mode')
    await expect(service.submit(sessionId, 'request-1', 'steer', [{ type: 'text', text: 'Explain this fixed selection.' }]))
      .rejects.toThrow('different content or delivery mode')
    await expect(service.submit('another-session', 'request-1', 'queue', [{ type: 'text', text: 'x' }]))
      .rejects.toThrow('belongs to another session')
  })

  it('shares one in-flight submission across concurrent calls', async () => {
    let now = 1_000
    const { service, followup } = setup(() => now)
    const sessionId = await service.create()
    const content = [{ type: 'text' as const, text: 'One logical submission.' }]
    const firstPending = service.submit(sessionId, 'request-concurrent', 'queue', content)
    now += 101
    const secondPending = service.submit(sessionId, 'request-concurrent', 'queue', content)
    const [first, second] = await Promise.all([firstPending, secondPending])
    expect(first).toEqual(second)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('recovers a persisted request receipt after service restart', async () => {
    const firstRuntime = setup()
    const sessionId = await firstRuntime.service.create()
    const accepted = await firstRuntime.service.submit(sessionId, 'request-persisted', 'queue', [{ type: 'text', text: 'Persist me.' }])
    const message = firstRuntime.followup.mock.calls[0]?.[0]
    const persisted = [{
      seq: 1,
      time: 1,
      type: 'agent/inbox/spliced',
      data: { target: 'next-turn', start: 0, inserted: [message] },
    } as SessionEvent]
    const restarted = setup(20_000, persisted)
    const duplicate = await restarted.service.submit('persisted-session', 'request-persisted', 'queue', [{ type: 'text', text: 'Persist me.' }])
    expect(duplicate).toEqual({ ...accepted, duplicate: true })
    expect(restarted.followup).not.toHaveBeenCalled()
  })

  it('expires only the in-memory receipt and rechecks durable history', async () => {
    let now = 1_000
    const { service, followup } = setup(() => now)
    const sessionId = await service.create()
    const content = [{ type: 'text' as const, text: 'Retention fixture.' }]
    await service.submit(sessionId, 'request-expiring', 'queue', content)
    now += 101
    await service.submit(sessionId, 'request-expiring', 'queue', content)
    expect(followup).toHaveBeenCalledTimes(2)
  })

  it('uses the host steering operation only when explicitly requested and cancels a live session', async () => {
    const { service, steer, cancel } = setup()
    const sessionId = await service.create()
    await service.submit(sessionId, 'request-steer', 'steer', [{ type: 'text', text: 'Change focus.' }])
    expect(steer).toHaveBeenCalledTimes(1)
    expect(service.cancel(sessionId)).toBe(true)
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(service.cancel('missing-session')).toBe(false)
  })

  it('buffers live events while durable history is being read and disposes to quiescence', async () => {
    const { ctx, service } = setup()
    const runtime = ctx as unknown as Record<string, unknown>
    let finishRead: ((snapshot: { header: { id: string }; events: SessionEvent[] }) => void) | undefined
    ;(runtime.sessionQuery as { readSession: (id: string) => Promise<unknown> }).readSession = id => new Promise(resolve => {
      finishRead = resolve as typeof finishRead
      expect(id).toBe('session-race')
    })
    const received: unknown[] = []
    const session = { id: SessionId('session-race') }
    const emit = ctx.emit.bind(ctx) as (name: string, ...args: unknown[]) => void
    const event = (seq: number, type: string, data: unknown): SessionEvent => ({ seq, time: seq, type, data } as SessionEvent)

    const subscribing = service.subscribe('session-race', 0, value => received.push(value))
    emit('session/event', session, event(2, 'user/message', {
      id: 'message-2', role: 'user', content: [], source: { kind: 'selection-companion', requestId: 'request-race' },
    }))
    finishRead?.({ header: { id: 'session-race' }, events: [event(1, 'turn/start', { turn: 1 })] })
    const subscription = await subscribing

    expect(received).toEqual([
      { cursor: 1, persistent: true, kind: 'status', data: { status: 'running', turn: 1 } },
      { cursor: 2, persistent: true, requestId: 'request-race', requestIds: ['request-race'], kind: 'status', data: { status: 'queued', turn: 1 } },
    ])
    emit('session/event', session, event(3, 'assistant/chunk', {
      turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'live' },
    }))
    expect(received.at(-1)).toMatchObject({ cursor: 3, persistent: true, requestId: 'request-race' })

    subscription.dispose()
    emit('session/event', session, event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(received).toHaveLength(3)
  })

  it('releases listeners when reading history fails', async () => {
    const { ctx, service } = setup()
    const runtime = ctx as unknown as Record<string, unknown>
    ;(runtime.sessionQuery as { readSession: () => Promise<never> }).readSession = async () => {
      throw new Error('history unavailable')
    }
    const listener = vi.fn()
    const emit = ctx.emit.bind(ctx) as (name: string, ...args: unknown[]) => void
    await expect(service.subscribe('session-failure', undefined, listener)).rejects.toThrow('history unavailable')
    emit('session/event', { id: SessionId('session-failure') }, {
      seq: 1, time: 1, type: 'turn/start', data: { turn: 1 },
    } as SessionEvent)
    expect(listener).not.toHaveBeenCalled()
  })

  it('marks agent status as non-persistent without advancing the durable cursor', async () => {
    const { ctx, service } = setup()
    const runtime = ctx as unknown as Record<string, unknown>
    ;(runtime.sessionQuery as { readSession: () => Promise<unknown> }).readSession = async () => ({
      header: { id: 'session-status' },
      events: [{ seq: 5, time: 5, type: 'turn/start', data: { turn: 1 } } as SessionEvent],
    })
    const received: unknown[] = []
    const emit = ctx.emit.bind(ctx) as (name: string, ...args: unknown[]) => void
    const subscription = await service.subscribe('session-status', 5, value => received.push(value))
    emit('agent/status', { agent: { id: SessionId('session-status') }, status: 'running' })
    expect(received).toEqual([{ cursor: 5, persistent: false, kind: 'status', data: { status: 'running' } }])
    subscription.dispose()
  })

  it('deduplicates a durable event observed in both the snapshot and live buffer', async () => {
    const { ctx, service } = setup()
    const runtime = ctx as unknown as Record<string, unknown>
    let finishRead: ((snapshot: { header: { id: string }; events: SessionEvent[] }) => void) | undefined
    ;(runtime.sessionQuery as { readSession: () => Promise<unknown> }).readSession = () => new Promise(resolve => {
      finishRead = resolve as typeof finishRead
    })
    const duplicate = { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } } as SessionEvent
    const received: unknown[] = []
    const subscribing = service.subscribe('session-duplicate', undefined, value => received.push(value))
    const emit = ctx.emit.bind(ctx) as (name: string, ...args: unknown[]) => void
    emit('session/event', { id: SessionId('session-duplicate') }, duplicate)
    finishRead?.({ header: { id: 'session-duplicate' }, events: [duplicate] })
    const subscription = await subscribing
    expect(received).toEqual([
      { cursor: 1, persistent: true, kind: 'status', data: { status: 'running', turn: 1 } },
    ])
    subscription.dispose()
  })

  it('rejects a cursor beyond durable history and releases the provisional listeners', async () => {
    const { ctx, service } = setup()
    const listener = vi.fn()
    await expect(service.subscribe('session-cursor', 9, listener)).rejects.toThrow(
      'session cursor 9 is ahead of durable high-water 0',
    )
    const emit = ctx.emit.bind(ctx) as (name: string, ...args: unknown[]) => void
    emit('session/event', { id: SessionId('session-cursor') }, {
      seq: 1, time: 1, type: 'turn/start', data: { turn: 1 },
    } as SessionEvent)
    expect(listener).not.toHaveBeenCalled()
  })

  it('reports and closes a live stream when a durable sequence number is missing', async () => {
    const { ctx, service } = setup()
    const runtime = ctx as unknown as Record<string, unknown>
    ;(runtime.sessionQuery as { readSession: () => Promise<unknown> }).readSession = async () => ({
      header: { id: 'session-gap' },
      events: [{ seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } } as SessionEvent],
    })
    const received: unknown[] = []
    await service.subscribe('session-gap', 1, value => received.push(value))
    const emit = ctx.emit.bind(ctx) as (name: string, ...args: unknown[]) => void
    emit('session/event', { id: SessionId('session-gap') }, {
      seq: 3, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
    } as SessionEvent)
    expect(received).toEqual([{
      cursor: 1,
      persistent: false,
      kind: 'error',
      data: { code: 'SESSION_SEQUENCE_GAP', expected: 2, actual: 3 },
    }])
    emit('session/event', { id: SessionId('session-gap') }, {
      seq: 4, time: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } },
    } as SessionEvent)
    expect(received).toHaveLength(1)
  })
})
