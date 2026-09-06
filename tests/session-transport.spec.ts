import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeIpcFrame,
  IpcFrameDecoder,
  BridgeMessageRouter,
  SelectionCompanionBridgeService,
  SelectionContextService,
  type IpcMessage,
} from '../src/index.js'
import type { SessionAgentEvent, SessionSubscription } from '../src/session/service.js'

interface TestSessions {
  readonly listeners: Set<(event: SessionAgentEvent) => void>
  readonly disposed: { value: number }
  list(): Promise<readonly []>
  create(): Promise<string>
  submit(): Promise<void>
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
    async create() { return 'session-transport' },
    async submit() {},
    cancel() { return true },
    async subscribe(_sessionId, cursor, listener) {
      listeners.add(listener)
      if (cursor !== undefined) listener({ cursor: cursor + 1, kind: 'status', data: { replay: true } })
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
    protocol: 1,
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

async function createFixture(idleTimeoutMs = 1_000): Promise<TransportFixture> {
  const context = new Context()
  new SelectionContextService(context)
  const sessions = createSessions()
  const bridge = new SelectionCompanionBridgeService(context, { endpoint: 'test-session-transport', idleTimeoutMs })
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
    expect(subscribed).toMatchObject({ id: 'subscribe-1', type: 'session.subscribed' })
    expect(replay).toMatchObject({ id: 'subscribe-1', type: 'agent.event', payload: { sessionId: 'session-transport' } })
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
})
