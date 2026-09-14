import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { normalizeSelectionMaterial, registerSelectionTools } from '../src/session/material.js'
import { SelectionCompanionSessionService } from '../src/session/service.js'

function setup() {
  const ctx = new Context()
  const runtime = ctx as unknown as Record<string, unknown>
  const agents = new Map<string, Record<string, unknown>>()
  const followup = vi.fn()
  const makeAgent = (id: string) => ({
    id: SessionId(id),
    status: 'idle',
    session: { events: [] },
    followup,
    steer: vi.fn(),
    cancel: vi.fn(),
  })
  runtime.agents = {
    get: (id: string) => agents.get(id),
    create: vi.fn(async (options: { sessionId: string; setup?: unknown }) => {
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
  runtime.agentDefaultModel = {
    currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
  }
  runtime.sessionQuery = {
    listSessions: async () => [],
    readTitleSnapshots: async () => [],
    readSession: async (id: string) => ({ session: { id }, header: { id }, events: [] }),
  }
  const service = new SelectionCompanionSessionService(ctx, { now: () => 10_000 })
  return { service, followup, runtime }
}

describe('EC-05 durable canonical material', () => {
  it('persists the expanded canonical material unchanged in user/message.source', async () => {
    const { service, followup, runtime } = setup()
    const sessionId = await service.create()
    expect((runtime.agents as { create: ReturnType<typeof vi.fn> }).create)
      .toHaveBeenCalledWith(expect.objectContaining({ setup: registerSelectionTools }))

    const material = normalizeSelectionMaterial({
      snapshotId: 'snapshot-ec05',
      revision: 5,
      capturedAt: 5_000,
      selection: { text: 'EC05 fixed selection' },
      source: { kind: 'browser', app: 'Chrome' },
      document: { title: 'EC05 fixture', url: 'https://example.test/ec05' },
      authorizedScope: 'local',
      actualScope: 'local',
      completeness: 'partial',
      truncated: true,
      context: {
        before: 'EC05_AUTHORIZED_BEFORE',
        after: 'EC05_AUTHORIZED_AFTER',
      },
    })
    const content = [{ type: 'text' as const, text: 'Canonical model prompt with authorized context.' }]

    await service.submit(sessionId, 'request-ec05', 'queue', content, material)
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]?.[0]
    expect(message).toMatchObject({
      role: 'user',
      content,
      source: {
        kind: 'selection-companion',
        requestId: 'request-ec05',
        deliveryMode: 'queue',
        material: {
          snapshotId: 'snapshot-ec05',
          revision: 5,
          authorizedScope: 'local',
          actualScope: 'local',
          completeness: 'partial',
          truncated: true,
          context: {
            before: 'EC05_AUTHORIZED_BEFORE',
            after: 'EC05_AUTHORIZED_AFTER',
          },
        },
      },
    })
    // Harness may snapshot/clone message source data; durable equality is structural.
    expect(message?.source.material).toStrictEqual(material)
  })
})
