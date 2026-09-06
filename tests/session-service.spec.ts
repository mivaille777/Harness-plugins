import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SelectionCompanionSessionService } from '../src/session/service.js'

function setup(now = 10_000) {
  const ctx = new Context()
  const runtime = ctx as unknown as Record<string, unknown>
  const agents = new Map<string, Record<string, unknown>>()
  const followup = vi.fn()
  const steer = vi.fn()
  const cancel = vi.fn()
  const makeAgent = (id: string) => ({
    id: SessionId(id), status: 'idle', session: { events: [] }, followup, steer, cancel,
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
  runtime.sessionQuery = { listSessions: async () => [{ header: { id: SessionId('persisted-session') } }] }
  const service = new SelectionCompanionSessionService(ctx, { now: () => now, submissionRetentionMs: 100 })
  return { ctx, agents, followup, steer, cancel, service }
}

describe('SelectionCompanionSessionService', () => {
  it('creates an ordinary Harness agent and lists persisted sessions', async () => {
    const { service } = setup()
    await expect(service.list()).resolves.toEqual([{ id: 'persisted-session', status: 'unknown' }])
    const id = await service.create('D:/fixture')
    expect(id).toMatch(/^selection-companion-/)
  })

  it('records one normal Harness user message and deduplicates its request id', async () => {
    const { service, followup } = setup()
    const sessionId = await service.create()
    await service.submit(sessionId, 'request-1', 'queue', [{ type: 'text', text: 'Explain this fixed selection.' }])
    await service.submit(sessionId, 'request-1', 'queue', [{ type: 'text', text: 'must not duplicate' }])
    expect(followup).toHaveBeenCalledTimes(1)
    expect(followup.mock.calls[0]?.[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Explain this fixed selection.' }],
      source: { kind: 'selection-companion', requestId: 'request-1' },
    })
    await expect(service.submit('another-session', 'request-1', 'queue', [{ type: 'text', text: 'x' }]))
      .rejects.toThrow('belongs to another session')
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
})
