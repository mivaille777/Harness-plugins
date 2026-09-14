import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SELECTION_READ_CONTEXT_TOOL_NAME,
  normalizeSelectionMaterial,
  readSelectionMaterialScope,
  registerSelectionTools,
  type SelectionMaterial,
} from '../src/session/material.js'

interface PromptPublisher {
  tools(callback: (context: { readonly scope?: object }) => unknown): () => void
  section(section: unknown): () => void
}

const scopes: Scope[] = []
let sequence = 0

afterEach(async () => {
  await Promise.all(scopes.splice(0).map(scope => scope.dispose()))
})

function expandedMaterial(
  actualScope: 'local' | 'section' | 'page',
  authorizedScope: 'local' | 'section' | 'page' = actualScope,
): SelectionMaterial {
  const context = actualScope === 'local'
    ? { before: 'LOCAL_BEFORE_SENTINEL', after: 'LOCAL_AFTER_SENTINEL' }
    : actualScope === 'section'
      ? { sectionText: 'SECTION_SENTINEL' }
      : { pageText: 'PAGE_SENTINEL' }
  return normalizeSelectionMaterial({
    snapshotId: `snapshot-${actualScope}`,
    revision: 6,
    capturedAt: 6_000,
    selection: { text: 'SELECTION_SENTINEL' },
    source: { kind: 'browser', app: 'Chrome' },
    authorizedScope,
    actualScope,
    completeness: 'partial',
    truncated: true,
    context,
  })
}

function selectionOnly(): SelectionMaterial {
  return normalizeSelectionMaterial({
    snapshotId: 'snapshot-selection',
    revision: 1,
    capturedAt: 1,
    selection: { text: 'ONLY_SELECTION' },
    source: { kind: 'browser' },
    authorizedScope: 'selection',
    actualScope: 'selection',
    completeness: 'complete',
  })
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}

function selectionMessage(seq: number, requestId: string, material: SelectionMaterial): SessionEvent {
  return event(seq, 'user/message', {
    id: `message-${requestId}`,
    role: 'user',
    content: [{ type: 'text', text: `Question for ${material.snapshotId}` }],
    source: { kind: 'selection-companion', requestId, material },
  })
}

function toolCall(seq: number, turn: number, callId: string, scope: string): SessionEvent {
  return event(seq, 'tool/call', {
    turn,
    step: 1,
    callId,
    name: SELECTION_READ_CONTEXT_TOOL_NAME,
    arguments: JSON.stringify({ scope }),
  })
}

function mount(events: SessionEvent[]): { ctx: Context; agent: Agent } {
  const ctx = new Context()
  ;(ctx as unknown as { systemPrompt: PromptPublisher }).systemPrompt = {
    tools: () => () => {},
    section: () => () => {},
  }
  new ToolRuntime(ctx)
  const agent = { id: 'agent-ec06', session: { events } } as unknown as Agent
  const scope = createScope(ctx, agent)
  scopes.push(scope)
  registerSelectionTools(scope.ctx.extend({ agent }))
  return { ctx, agent }
}

async function execute(ctx: Context, agent: Agent, callId: string, scope: string) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: callId as never,
    name: SELECTION_READ_CONTEXT_TOOL_NAME,
    arguments: { scope },
    agent,
  })
}

function nextCallId(): string {
  sequence += 1
  return `ec06-call-${sequence}`
}

describe('EC-06 durable scope reader', () => {
  it('always allows the exact persisted selection, even when a broader scope is actual', () => {
    expect(readSelectionMaterialScope(expandedMaterial('page'), 'selection')).toBe('SELECTION_SENTINEL')
  })

  it('returns only the context shape that was actually persisted', () => {
    const local = readSelectionMaterialScope(expandedMaterial('local'), 'local')
    expect(local).toContain('LOCAL_BEFORE_SENTINEL')
    expect(local).toContain('SELECTION_SENTINEL')
    expect(local).toContain('LOCAL_AFTER_SENTINEL')
    expect(local).not.toContain('SECTION_SENTINEL')
    expect(local).not.toContain('PAGE_SENTINEL')
    expect(readSelectionMaterialScope(expandedMaterial('section'), 'section')).toBe('SECTION_SENTINEL')
    expect(readSelectionMaterialScope(expandedMaterial('page'), 'page')).toBe('PAGE_SENTINEL')
  })

  it('rejects an unauthorized expanded scope', () => {
    expect(() => readSelectionMaterialScope(selectionOnly(), 'local'))
      .toThrow('exceeds authorized scope selection')
  })

  it('rejects a scope that was authorized broadly but not actually persisted', () => {
    const fallback = expandedMaterial('section', 'page')
    expect(readSelectionMaterialScope(fallback, 'section')).toBe('SECTION_SENTINEL')
    expect(() => readSelectionMaterialScope(fallback, 'page'))
      .toThrow('not available in persisted actual scope section')
    expect(() => readSelectionMaterialScope(fallback, 'local'))
      .toThrow('not available in persisted actual scope section')
  })

  it('reads expanded context from the durable tool-call turn through the real ToolRuntime', async () => {
    const callId = nextCallId()
    const local = expandedMaterial('local')
    const { ctx, agent } = mount([
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-local', local),
      toolCall(3, 1, callId, 'local'),
    ])

    const result = await execute(ctx, agent, callId, 'local')
    expect(result).toMatchObject({
      isError: false,
      value: {
        requestId: 'request-local',
        snapshotId: 'snapshot-local',
        authorizedScope: 'local',
        actualScope: 'local',
        readScope: 'local',
        text: expect.stringContaining('LOCAL_BEFORE_SENTINEL'),
      },
    })
  })

  it('does not let a later selection contaminate an earlier tool call', async () => {
    const callId = nextCallId()
    const oldLocal = expandedMaterial('local')
    const newerPage = normalizeSelectionMaterial({
      ...expandedMaterial('page'),
      snapshotId: 'snapshot-newer-page',
      revision: 7,
      context: { pageText: 'NEWER_PAGE_MUST_NOT_LEAK' },
    })
    const { ctx, agent } = mount([
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-old-local', oldLocal),
      toolCall(3, 1, callId, 'local'),
      event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(5, 'turn/start', { turn: 2 }),
      selectionMessage(6, 'request-new-page', newerPage),
    ])

    const result = await execute(ctx, agent, callId, 'local')
    expect(result).toMatchObject({
      isError: false,
      value: { requestId: 'request-old-local', snapshotId: 'snapshot-local' },
    })
    expect(JSON.stringify(result)).not.toContain('NEWER_PAGE_MUST_NOT_LEAK')
  })

  it('fails closed when the tool asks for a scope absent from durable material', async () => {
    const callId = nextCallId()
    const { ctx, agent } = mount([
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-selection-only', selectionOnly()),
      toolCall(3, 1, callId, 'page'),
    ])

    const result = await execute(ctx, agent, callId, 'page')
    expect(result).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('exceeds authorized scope selection') },
    })
  })
})
