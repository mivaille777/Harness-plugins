import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { normalizeSelectionMaterial, registerSelectionTools } from '../src/session/material.js'
import { SelectionCompanionSessionService } from '../src/session/service.js'

function pageMaterial(pageText = 'EC07_PAGE_CONTEXT_SENTINEL_83917') {
  return normalizeSelectionMaterial({
    snapshotId: 'snapshot-ec07-a',
    revision: 7,
    capturedAt: 7_000,
    selection: { text: 'EC07_SELECTED_TOKEN_A' },
    source: { kind: 'browser', app: 'Chrome' },
    document: { title: 'EC07 fixture', url: 'https://example.test/ec07' },
    authorizedScope: 'page',
    actualScope: 'page',
    completeness: 'complete',
    truncated: false,
    context: { pageText },
  })
}

function setup(initialEvents: SessionEvent[] = []) {
  const ctx = new Context()
  const runtime = ctx as unknown as Record<string, unknown>
  const agents = new Map<string, Record<string, unknown>>()
  const followup = vi.fn()
  const resume = vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
    const agent = {
      id: SessionId(resumeSessionId),
      status: 'idle',
      session: { events: initialEvents },
      followup,
      steer: vi.fn(),
      cancel: vi.fn(),
    }
    agents.set(resumeSessionId, agent)
    return { agent, dispose: async () => { agents.delete(resumeSessionId) } }
  })
  const create = vi.fn(async (options: { sessionId: string }) => {
    const agent = {
      id: SessionId(options.sessionId),
      status: 'idle',
      session: { events: [] },
      followup,
      steer: vi.fn(),
      cancel: vi.fn(),
    }
    agents.set(options.sessionId, agent)
    return { agent, dispose: async () => { agents.delete(options.sessionId) } }
  })
  runtime.agents = { get: (id: string) => agents.get(id), create, resume }
  runtime.agentDefaultModel = { currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }) }
  runtime.sessionQuery = {
    listSessions: async () => [],
    readTitleSnapshots: async () => [],
    readSession: async (id: string) => ({ session: { id }, header: { id }, events: initialEvents }),
  }
  return {
    service: new SelectionCompanionSessionService(ctx, { now: () => 10_000 }),
    followup,
    create,
    resume,
  }
}

describe('EC-07 durable restart and replay', () => {
  it('recovers the exact expanded request after service restart without a second followup', async () => {
    const first = setup()
    const sessionId = await first.service.create()
    const material = pageMaterial()
    const content = [{ type: 'text' as const, text: 'Explain EC07_SELECTED_TOKEN_A using the authorized page context.' }]
    const accepted = await first.service.submit(sessionId, 'request-ec07', 'queue', content, material)
    const message = first.followup.mock.calls[0]?.[0]

    expect(message?.source.material).toBe(material)
    expect(message?.source.material.context.pageText).toBe('EC07_PAGE_CONTEXT_SENTINEL_83917')

    const persisted = [{
      seq: 1,
      time: 1,
      type: 'agent/inbox/spliced',
      data: { target: 'next-turn', start: 0, inserted: [message] },
    } as SessionEvent]

    const restarted = setup(persisted)
    const duplicate = await restarted.service.submit('persisted-session', 'request-ec07', 'queue', content, material)

    expect(duplicate).toEqual({ ...accepted, duplicate: true })
    expect(restarted.followup).not.toHaveBeenCalled()
    expect(restarted.resume).toHaveBeenCalledWith(expect.objectContaining({ setup: registerSelectionTools }))
  })

  it('rejects reuse of the same request id with material from a newer selection after restart', async () => {
    const first = setup()
    const sessionId = await first.service.create()
    const original = pageMaterial()
    const content = [{ type: 'text' as const, text: 'Explain the frozen EC07 request.' }]
    await first.service.submit(sessionId, 'request-ec07-conflict', 'queue', content, original)
    const message = first.followup.mock.calls[0]?.[0]
    const persisted = [{
      seq: 1,
      time: 1,
      type: 'agent/inbox/spliced',
      data: { target: 'next-turn', start: 0, inserted: [message] },
    } as SessionEvent]

    const restarted = setup(persisted)
    const newerSelection = normalizeSelectionMaterial({
      ...pageMaterial('NEWER_PAGE_MUST_NOT_REPLACE_OLD_REQUEST'),
      snapshotId: 'snapshot-ec07-b',
      revision: 8,
      selection: { text: 'EC07_SELECTED_TOKEN_B' },
    })

    await expect(restarted.service.submit(
      'persisted-session',
      'request-ec07-conflict',
      'queue',
      content,
      newerSelection,
    )).rejects.toThrow('persisted with different content or delivery mode')
    expect(restarted.followup).not.toHaveBeenCalled()
  })
})
