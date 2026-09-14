import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeIpcFrame,
  IpcFrameDecoder,
  BridgeMessageRouter,
  IPC_PROTOCOL_VERSION,
  SelectionCompanionBridgeService,
  SelectionContextService,
  type IpcMessage,
} from '../src/index.js'
import type { SessionAgentEvent, SessionSubmissionResult, SessionSubscription } from '../src/session/service.js'

interface TestSessions {
  readonly listeners: Set<(event: SessionAgentEvent) => void>
  readonly disposed: { value: number }
  list(): Promise<readonly []>
  history(): Promise<{ readonly sessionId: string; readonly capturedThroughCursor: number; readonly entries: readonly [] }>
  create(): Promise<string>
  submit(): Promise<SessionSubmissionResult>
  cancel(): boolean
  subscribe(sessionId: string, cursor: number | undefined, listener: (event: SessionAgentEvent) => void): Promise<SessionSubscription>
}

function createSessions(): TestSessions {
  const listeners = new Set<(event: SessionAgentEvent) => void>()
  const disposed = { value: 0 }
  return {
    listeners,
    disposed,
    async list() { return [] },
    async history() { return { sessionId: 'session-transport', capturedThroughCursor: 0, entries: [] } },
    async create() { return 'session-transport' },
    async submit() { return { requestId: 'request-test', messageId: 'message-test', delivery: 'queued', duplicate: false } },
    cancel() { return true },
    async subscribe(_sessionId, cursor, listener) {
      listeners.add(listener)
      if (cursor !== undefined) listener({ cursor: cursor + 1, persistent: true, kind: 'status', data: { replay: true } })
      return {
        dispose: () => {
          disposed.value += 1
          listeners.delete(listener)
        },
      }
    },
  }
}

function subscribeMessage(id: string, cursor?: number): IpcMessage {
  return {
    protocol: IPC_PROTOCOL_VERSION,
    id,
    type: 'session.subscribe',
    payload: { sessionId: 'session-transport', ...(cursor === undefined ? {} : { cursor }) },
  }
}

function openClient(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function readMessages(socket: Socket, count: number): Promise<IpcMessage[]> {
  return new Promise((resolve, reject) => {
    const decoder = new IpcFrameDecoder()
    const messages: IpcMessage[] = []
    const onData = (chunk: Buffer): void => {
      try {
        messages.push(...decoder.push(chunk))
        if (messages.length >= count) {
          cleanup()
          resolve(messages)
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      socket.off('data', onData)
      socket.off('error', onError)
    }
    socket.on('data', onData)
    socket.once('error', onError)
  })
}

interface TransportFixture {
  readonly context: Context
  readonly port: number
  readonly server: Server
  readonly sessions: TestSessions
}

async function createFixture(
  idleTimeoutMs = 1_000,
  sessions = createSessions(),
  maxPendingWriteBytes?: number,
): Promise<TransportFixture> {
  const context = new Context()
  new SelectionContextService(context)
  const bridge = new SelectionCompanionBridgeService(context, {
    endpoint: 'test-session-transport',
    idleTimeoutMs,
    ...(maxPendingWriteBytes === undefined ? {} : { maxPendingWriteBytes }),
  })
  ;(bridge as unknown as { router: BridgeMessageRouter }).router = new BridgeMessageRouter(
    context.selectionContext,
    sessions,
  )
  const accept = (bridge as unknown as { accept(socket: Socket): void }).accept.bind(bridge)
  const server = createServer(accept)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server has no TCP address')
  return { context, port: address.port, server, sessions }
}

async function closeFixture(fixture: TransportFixture, sockets: readonly Socket[] = []): Promise<void> {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => fixture.server.close(() => resolve()))
}

describe('session subscription transport', () => {
  const fixtures: TransportFixture[] = []

  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map(fixture => closeFixture(fixture)))
  })

  it('writes session.subscribed before a synchronous replay event from a fragmented frame', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const socket = await openClient(fixture.port)
    const frame = encodeIpcFrame(subscribeMessage('subscribe-1', 7))
    const received = readMessages(socket, 2)
    socket.write(frame.subarray(0, 3))
    socket.write(frame.subarray(3))

    const [subscribed, replay] = await received
    expect(subscribed).toMatchObject({
      id: 'subscribe-1',
      type: 'session.subscribed',
      payload: { subscriptionId: 'subscribe-1' },
    })
    expect(replay).toMatchObject({
      id: 'subscribe-1',
      type: 'agent.event',
      payload: { sessionId: 'session-transport', subscriptionId: 'subscribe-1' },
    })
    socket.destroy()
  })

  it('keeps independent subscriptions and disposes each one when its socket closes', async () => {
    const fixture = await createFixture()
    fixtures.push(fixture)
    const first = await openClient(fixture.port)
    const second = await openClient(fixture.port)
    const firstFrames = readMessages(first, 1)
    const secondFrames = readMessages(second, 1)
    first.write(encodeIpcFrame(subscribeMessage('subscribe-first')))
    second.write(encodeIpcFrame(subscribeMessage('subscribe-second')))
    const [[firstResponse], [secondResponse]] = await Promise.all([firstFrames, secondFrames])
    expect(firstResponse).toMatchObject({ type: 'session.subscribed' })
    expect(secondResponse).toMatchObject({ type: 'session.subscribed' })
    expect(fixture.sessions.listeners.size).toBe(2)

    first.destroy()
    await vi.waitFor(() => expect(fixture.sessions.disposed.value).toBe(1))
    expect(fixture.sessions.listeners.size).toBe(1)

    second.destroy()
    await vi.waitFor(() => expect(fixture.sessions.disposed.value).toBe(2))
  })

  it('returns an error frame for malformed input and closes an idle socket', async () => {
    const fixture = await createFixture(20)
    fixtures.push(fixture)
    const malformed = await openClient(fixture.port)
    const error = readMessages(malformed, 1)
    malformed.write(Buffer.from([0, 0, 0, 1, 0]))
    await expect(error).resolves.toMatchObject([{ type: 'error.response' }])

    const idle = await openClient(fixture.port)
    const closed = new Promise<void>(resolve => idle.once('close', () => resolve()))
    await expect(closed).resolves.toBeUndefined()
  })

  it('disposes a subscription that resolves after its socket closes', async () => {
    const sessions = createSessions()
    let markStarted: (() => void) | undefined
    let finishSubscribe: (() => void) | undefined
    const started = new Promise<void>(resolve => { markStarted = resolve })
    sessions.subscribe = async (_sessionId, _cursor, listener) => {
      sessions.listeners.add(listener)
      markStarted?.()
      await new Promise<void>(resolve => { finishSubscribe = resolve })
      return {
        dispose: () => {
          sessions.disposed.value += 1
          sessions.listeners.delete(listener)
        },
      }
    }
    const fixture = await createFixture(1_000, sessions)
    fixtures.push(fixture)
    const socket = await openClient(fixture.port)
    socket.write(encodeIpcFrame(subscribeMessage('subscribe-late')))
    await started
    socket.destroy()
    finishSubscribe?.()
    await vi.waitFor(() => expect(sessions.disposed.value).toBe(1))
    expect(sessions.listeners.size).toBe(0)
  })

  it('keeps an acknowledged subscription open beyond the request idle timeout', async () => {
    const fixture = await createFixture(20)
    fixtures.push(fixture)
    const socket = await openClient(fixture.port)
    const subscribed = readMessages(socket, 1)
    socket.write(encodeIpcFrame(subscribeMessage('subscribe-long-wait')))
    await subscribed
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(socket.destroyed).toBe(false)

    const received = readMessages(socket, 1)
    for (const listener of fixture.sessions.listeners) {
      listener({ cursor: 1, persistent: true, kind: 'status', data: { status: 'running' } })
    }
    await expect(received).resolves.toMatchObject([{
      type: 'agent.event', payload: { subscriptionId: 'subscribe-long-wait' },
    }])
    socket.destroy()
  })

  it('closes a subscription whose pending write budget is exceeded', async () => {
    const fixture = await createFixture(1_000, createSessions(), 256)
    fixtures.push(fixture)
    const socket = await openClient(fixture.port)
    const subscribed = readMessages(socket, 1)
    socket.write(encodeIpcFrame(subscribeMessage('subscribe-backpressure')))
    await subscribed
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    for (const listener of fixture.sessions.listeners) {
      listener({ cursor: 1, persistent: true, kind: 'status', data: { detail: 'x'.repeat(512) } })
    }
    await closed
    await vi.waitFor(() => expect(fixture.sessions.disposed.value).toBe(1))
  })
})
