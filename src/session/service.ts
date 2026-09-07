import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { AgentEventKind, SessionDeliveryMode, SessionSummary } from '../bridge/protocol.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'selection-companion': {
      readonly kind: 'selection-companion'
      readonly requestId: string
    }
  }
}

export const DEFAULT_SUBMISSION_RETENTION_MS = 5 * 60_000

export interface SessionAgentEvent {
  readonly cursor: number
  readonly persistent: boolean
  readonly requestId?: string
  readonly kind: AgentEventKind
  readonly data: unknown
}

/** Maps durable selection request messages to their enclosing Harness turn. */
export class RequestTurnTracker {
  private openTurn: number | undefined
  private readonly requests = new Map<number, string>()

  project(event: SessionEvent): SessionAgentEvent {
    switch (event.type) {
      case 'turn/start':
        this.openTurn = event.data.turn
        return { cursor: event.seq, persistent: true, kind: 'status', data: { status: 'running', turn: event.data.turn } }
      case 'user/message': {
        if (event.data.source.kind === 'selection-companion' && this.openTurn !== undefined) {
          this.requests.set(this.openTurn, event.data.source.requestId)
          return {
            cursor: event.seq,
            persistent: true,
            requestId: event.data.source.requestId,
            kind: 'status',
            data: { status: 'queued', turn: this.openTurn },
          }
        }
        return { cursor: event.seq, persistent: true, kind: 'status', data: { type: event.type } }
      }
      case 'assistant/chunk':
        return this.withStep(event.seq, event.data.turn, event.data.step, 'assistant-delta', event.data.chunk)
      case 'assistant/message':
        return this.withStep(event.seq, event.data.turn, event.data.step, 'assistant-complete', event.data.message)
      case 'tool/call':
        return this.withStep(event.seq, event.data.turn, event.data.step, 'tool-call', event.data)
      case 'tool/result':
        return this.withStep(event.seq, event.data.turn, event.data.step, 'tool-result', event.data)
      case 'turn/end': {
        const result = this.withTurn(event.seq, event.data.turn, 'status', {
          status: 'turn-end',
          turn: event.data.turn,
          reason: event.data.reason,
        })
        this.requests.delete(event.data.turn)
        if (this.openTurn === event.data.turn) this.openTurn = undefined
        return result
      }
      default:
        return { cursor: event.seq, persistent: true, kind: 'status', data: { type: event.type, data: event.data } }
    }
  }

  private withTurn(
    cursor: number,
    turn: number,
    kind: AgentEventKind,
    data: unknown,
  ): SessionAgentEvent {
    const requestId = this.requests.get(turn)
    return { cursor, persistent: true, ...(requestId === undefined ? {} : { requestId }), kind, data }
  }

  private withStep(
    cursor: number,
    turn: number,
    step: number,
    kind: AgentEventKind,
    value: unknown,
  ): SessionAgentEvent {
    return this.withTurn(cursor, turn, kind, { turn, step, value })
  }
}

export interface SessionSubscription {
  dispose(): void
}

export interface SelectionCompanionSessionOptions {
  readonly submissionRetentionMs?: number
  readonly now?: () => number
}

interface SubmissionReceipt {
  readonly sessionId: string
  readonly expiresAt: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    selectionCompanionSessions: SelectionCompanionSessionService
  }
}

/**
 * Consumer of the installed Harness Agent, Session, and SessionQuery services.
 * It owns no model client or history: every prompt is a normal durable Harness user message.
 */
export class SelectionCompanionSessionService extends Service {
  static inject = ['agents', 'agentDefaultModel', 'sessionQuery']

  private readonly handles = new Map<string, { dispose(): Promise<void> }>()
  private readonly submissions = new Map<string, SubmissionReceipt>()
  private readonly submissionRetentionMs: number
  private readonly now: () => number

  constructor(ctx: Context, options: SelectionCompanionSessionOptions = {}) {
    super(ctx, 'selectionCompanionSessions')
    this.submissionRetentionMs = options.submissionRetentionMs ?? DEFAULT_SUBMISSION_RETENTION_MS
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.submissionRetentionMs) || this.submissionRetentionMs <= 0) {
      throw new RangeError('submissionRetentionMs must be a positive safe integer')
    }
    this.ctx.effect(() => async () => {
      await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
      this.handles.clear()
    }, 'selectionCompanionSessions.agents')
  }

  async list(): Promise<readonly SessionSummary[]> {
    const records = await this.ctx.sessionQuery.listSessions()
    return records.map(record => {
      const id = String(record.header.id)
      const agent = this.ctx.agents.get(record.header.id)
      return { id, status: agent?.status ?? 'unknown' }
    })
  }

  async create(cwd?: string): Promise<string> {
    const id = SessionId(`selection-companion-${randomUUID()}`)
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const handle = await this.ctx.agents.create({
      sessionId: id,
      meta: { cwd: resolve(cwd ?? process.cwd()) },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    this.handles.set(String(id), handle)
    return String(id)
  }

  async submit(
    sessionId: string,
    requestId: string,
    mode: SessionDeliveryMode,
    content: readonly ContentBlock[],
  ): Promise<void> {
    this.expireSubmissions()
    const previous = this.submissions.get(requestId)
    if (previous !== undefined) {
      if (previous.sessionId !== sessionId) throw new Error(`requestId ${requestId} belongs to another session`)
      return
    }

    const agent = await this.resolveAgent(sessionId)
    const message = createUserMessage({
      content: [...content],
      source: { kind: 'selection-companion', requestId },
    })
    if (mode === 'queue') agent.followup(message)
    else agent.steer(message)
    this.submissions.set(requestId, { sessionId, expiresAt: this.now() + this.submissionRetentionMs })
  }

  cancel(sessionId: string): boolean {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) return false
    agent.cancel({ kind: 'user' })
    return true
  }

  async subscribe(
    sessionId: string,
    cursor: number | undefined,
    listener: (event: SessionAgentEvent) => void,
  ): Promise<SessionSubscription> {
    const id = SessionId(sessionId)
    const tracker = new RequestTurnTracker()
    const bufferedEvents: SessionEvent[] = []
    const bufferedStatuses: unknown[] = []
    let ready = false
    let disposed = false
    let lastProjectedSeq: number | undefined
    let lastDeliveredSeq = cursor

    const dispose = (): void => {
      if (disposed) return
      disposed = true
      stopSessionEvents()
      stopStatusEvents()
    }
    const deliverStatus = (status: unknown): void => {
      if (disposed) return
      listener({ cursor: lastProjectedSeq ?? 0, persistent: false, kind: 'status', data: { status } })
    }
    const projectDurable = (event: SessionEvent): void => {
      if (disposed || (lastProjectedSeq !== undefined && event.seq <= lastProjectedSeq)) return
      if (lastProjectedSeq !== undefined && event.seq !== lastProjectedSeq + 1) {
        listener({
          cursor: lastProjectedSeq,
          persistent: false,
          kind: 'error',
          data: { code: 'SESSION_SEQUENCE_GAP', expected: lastProjectedSeq + 1, actual: event.seq },
        })
        dispose()
        return
      }
      const projected = tracker.project(event)
      lastProjectedSeq = event.seq
      if (lastDeliveredSeq === undefined || event.seq > lastDeliveredSeq) {
        listener(projected)
        lastDeliveredSeq = event.seq
      }
    }

    const stopSessionEvents = this.ctx.on('session/event', (session, event) => {
      if (session.id !== id || disposed) return
      if (ready) projectDurable(event)
      else bufferedEvents.push(event)
    })
    const stopStatusEvents = this.ctx.on('agent/status', ({ agent, status }) => {
      if (agent.id !== id || disposed) return
      if (ready) deliverStatus(status)
      else bufferedStatuses.push(status)
    })

    try {
      const snapshot = await this.ctx.sessionQuery.readSession(id)
      const events = new Map<number, SessionEvent>()
      for (const event of snapshot.events) events.set(event.seq, event)
      for (const event of bufferedEvents) events.set(event.seq, event)
      const ordered = [...events.values()].sort((left, right) => left.seq - right.seq)
      const highWater = ordered.at(-1)?.seq
      if (cursor !== undefined && (highWater === undefined ? cursor !== 0 : cursor > highWater)) {
        throw new RangeError(`session cursor ${cursor} is ahead of durable high-water ${highWater ?? 0}`)
      }
      if (cursor !== undefined && ordered.length > 0 && ordered[0]!.seq > cursor + 1) {
        throw new RangeError(`session history starts at ${ordered[0]!.seq}, after requested cursor ${cursor}`)
      }
      for (const event of ordered) projectDurable(event)
      ready = true
      for (const status of bufferedStatuses) deliverStatus(status)
      return { dispose }
    } catch (error) {
      dispose()
      throw error
    }
  }

  private async resolveAgent(sessionId: string): Promise<Agent> {
    const id = SessionId(sessionId)
    const live = this.ctx.agents.get(id)
    if (live !== undefined) return live
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const handle = await this.ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    this.handles.set(String(id), handle)
    return handle.agent
  }

  private expireSubmissions(): void {
    const now = this.now()
    for (const [id, submission] of this.submissions) {
      if (submission.expiresAt <= now) this.submissions.delete(id)
    }
  }

}
