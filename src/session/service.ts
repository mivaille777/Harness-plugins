import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { AgentEventKind, SessionDeliveryMode, SessionSummary } from '../bridge/protocol.js'

export const DEFAULT_SUBMISSION_RETENTION_MS = 5 * 60_000

export interface SessionAgentEvent {
  readonly cursor: number
  readonly kind: AgentEventKind
  readonly data: unknown
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
      source: { kind: 'plugin', plugin: 'selection-companion' },
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
    if (cursor !== undefined) {
      const snapshot = await this.ctx.sessionQuery.readSession(id)
      for (const event of snapshot.events) {
        if (event.seq > cursor) listener(this.projectEvent(event))
      }
    }
    const stopSessionEvents = this.ctx.on('session/event', (session, event) => {
      if (session.id === id) listener(this.projectEvent(event))
    })
    const stopStatusEvents = this.ctx.on('agent/status', ({ agent, status }) => {
      if (agent.id === id) listener({ cursor: agent.session.events.at(-1)?.seq ?? 0, kind: 'status', data: { status } })
    })
    return { dispose: () => { stopSessionEvents(); stopStatusEvents() } }
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

  private projectEvent(event: SessionEvent): SessionAgentEvent {
    switch (event.type) {
      case 'assistant/chunk':
        return { cursor: event.seq, kind: 'assistant-delta', data: event.data.chunk }
      case 'assistant/message':
        return { cursor: event.seq, kind: 'assistant-complete', data: event.data.message }
      case 'tool/call':
        return { cursor: event.seq, kind: 'tool-call', data: event.data }
      case 'tool/result':
        return { cursor: event.seq, kind: 'tool-result', data: event.data }
      case 'turn/end':
        return { cursor: event.seq, kind: 'status', data: { status: 'idle', reason: event.data.reason } }
      default:
        return { cursor: event.seq, kind: 'status', data: { type: event.type, data: event.data } }
    }
  }
}
