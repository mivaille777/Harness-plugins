import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SELECTION_CURRENT_TOOL_NAME,
  SELECTION_READ_CONTEXT_TOOL_NAME,
  registerSelectionTools,
  type SelectionMaterial,
} from '../src/session/material.js'

/**
 * ToolRuntime only asks this dependency to publish prompt contributions. The
 * tests exercise its real registry, scoped routing, and execution pipeline;
 * prompt assembly belongs to the upstream SystemPrompt package.
 */
interface PromptPublisher {
  tools(callback: (context: { readonly scope?: object }) => unknown): () => void
  section(section: unknown): () => void
}

type ToolTestContext = Context

interface ToolFixture {
  readonly ctx: ToolTestContext
  readonly scopes: Scope[]
}

let callSequence = 0
const fixtures: ToolFixture[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).flatMap(fixture => fixture.scopes.map(scope => scope.dispose())))
})

function mount(): ToolFixture {
  const ctx = new Context()
  ;(ctx as unknown as { systemPrompt: PromptPublisher }).systemPrompt = {
    tools: () => () => {},
    section: () => () => {},
  }
  new ToolRuntime(ctx)
  const fixture = { ctx, scopes: [] }
  fixtures.push(fixture)
  return fixture
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}

function agentScope(
  fixture: ToolFixture,
  id: string,
  events: SessionEvent[],
  registerTools = true,
): Agent {
  const agent = {
    id,
    session: { events },
  } as unknown as Agent
  const scope = createScope(fixture.ctx, agent)
  fixture.scopes.push(scope)
  if (registerTools) registerSelectionTools(scope.ctx.extend({ agent }))
  return agent
}

function material(snapshotId: string, text: string, revision = 1): SelectionMaterial {
  return {
    snapshotId,
    revision,
    capturedAt: 1_700_000_000_000 + revision,
    selection: { text, language: 'text' },
    source: { kind: 'browser', app: 'Harness test browser', windowTitle: `Document ${snapshotId}` },
    document: { title: `Document ${snapshotId}`, url: `https://example.test/${snapshotId}` },
    authorizedScope: 'selection',
    actualScope: 'selection',
    completeness: 'complete',
  }
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}

function selectionMessage(seq: number, requestId: string, sourceMaterial: SelectionMaterial): SessionEvent {
  return event(seq, 'user/message', {
    id: `message-${requestId}`,
    role: 'user',
    content: [{ type: 'text', text: `Question for ${sourceMaterial.snapshotId}` }],
    source: { kind: 'selection-companion', requestId, material: sourceMaterial },
  })
}

function toolCall(seq: number, turn: number, callId: string): SessionEvent {
  return event(seq, 'tool/call', {
    turn,
    step: 1,
    callId,
    name: SELECTION_READ_CONTEXT_TOOL_NAME,
    arguments: '{"scope":"selection"}',
  })
}

async function execute(
  fixture: ToolFixture,
  agent: Agent,
  name: string,
  callId: string,
  argumentsValue: unknown,
  signal = new AbortController().signal,
): Promise<ToolExecutionResult> {
  return fixture.ctx.tools.execute({
    signal,
    callId: callId as never,
    name,
    arguments: argumentsValue,
    agent,
  })
}

function nextCallId(label: string): string {
  callSequence += 1
  return `${label}-${callSequence}`
}

describe('session-bound selection tools', () => {
  it('keeps two Agent sessions isolated while executing the real ToolRuntime pipeline', async () => {
    const fixture = mount()
    const firstCall = nextCallId('first-read')
    const secondCall = nextCallId('second-read')
    const firstMaterial = material('snapshot-first', 'Only the first Agent may read this text.')
    const secondMaterial = material('snapshot-second', 'Only the second Agent may read this text.')
    const first = agentScope(fixture, 'agent-first', [
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-first', firstMaterial),
      toolCall(3, 1, firstCall),
    ])
    const second = agentScope(fixture, 'agent-second', [
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-second', secondMaterial),
      toolCall(3, 1, secondCall),
    ])

    const [firstResult, secondResult] = await Promise.all([
      execute(fixture, first, SELECTION_READ_CONTEXT_TOOL_NAME, firstCall, { scope: 'selection' }),
      execute(fixture, second, SELECTION_READ_CONTEXT_TOOL_NAME, secondCall, { scope: 'selection' }),
    ])

    expect(firstResult).toMatchObject({
      isError: false,
      value: { requestId: 'request-first', snapshotId: 'snapshot-first', text: firstMaterial.selection.text },
    })
    expect(secondResult).toMatchObject({
      isError: false,
      value: { requestId: 'request-second', snapshotId: 'snapshot-second', text: secondMaterial.selection.text },
    })
    expect(firstResult.content).not.toEqual(secondResult.content)
  })

  it('uses the most recent persisted selection material in one turn', async () => {
    const fixture = mount()
    const callId = nextCallId('latest-read')
    const earlier = material('snapshot-earlier', 'Earlier selection must not be returned.', 1)
    const latest = material('snapshot-latest', 'This newer selection is the only readable source.', 2)
    const agent = agentScope(fixture, 'agent-latest', [
      event(1, 'turn/start', { turn: 7 }),
      selectionMessage(2, 'request-earlier', earlier),
      selectionMessage(3, 'request-latest', latest),
      toolCall(4, 7, callId),
    ])

    const result = await execute(fixture, agent, SELECTION_READ_CONTEXT_TOOL_NAME, callId, { scope: 'selection' })

    expect(result).toMatchObject({
      isError: false,
      value: { requestId: 'request-latest', snapshotId: 'snapshot-latest', text: latest.selection.text },
    })
  })

  it('fails closed when the durable turn has no selection material', async () => {
    const fixture = mount()
    const callId = nextCallId('missing-read')
    const agent = agentScope(fixture, 'agent-missing', [
      event(1, 'turn/start', { turn: 2 }),
      event(2, 'user/message', {
        id: 'ordinary-message',
        role: 'user',
        content: [{ type: 'text', text: 'Do not infer a selection from this prompt.' }],
        source: { kind: 'user' },
      }),
      toolCall(3, 2, callId),
    ])

    const result = await execute(fixture, agent, SELECTION_CURRENT_TOOL_NAME, callId, {})

    expect(result).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('no persisted selection material') },
    })
  })

  it('does not expose an Agent-scoped tool to another Agent', async () => {
    const fixture = mount()
    const ownerCall = nextCallId('owner-read')
    const intruderCall = nextCallId('intruder-read')
    const owner = agentScope(fixture, 'agent-owner', [
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-owner', material('snapshot-owner', 'Owner-only material.')),
      toolCall(3, 1, ownerCall),
    ])
    const intruder = agentScope(fixture, 'agent-intruder', [
      event(1, 'turn/start', { turn: 1 }),
      toolCall(2, 1, intruderCall),
    ], false)

    const ownerResult = await execute(fixture, owner, SELECTION_READ_CONTEXT_TOOL_NAME, ownerCall, { scope: 'selection' })
    const intruderResult = await execute(fixture, intruder, SELECTION_READ_CONTEXT_TOOL_NAME, intruderCall, { scope: 'selection' })

    expect(ownerResult).toMatchObject({ isError: false, value: { text: 'Owner-only material.' } })
    expect(intruderResult).toMatchObject({
      isError: true,
      error: { info: { code: 'UNKNOWN_TOOL' } },
    })
  })

  it('honors an Agent-scoped policy denial and logs its final error result', async () => {
    const fixture = mount()
    const callId = nextCallId('policy-read')
    const agent = agentScope(fixture, 'agent-policy', [
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-policy', material('snapshot-policy', 'Policy must prevent this read.')),
      toolCall(3, 1, callId),
    ])
    const scope = fixture.scopes.at(-1)
    if (scope === undefined) throw new Error('fixture did not retain the Agent scope')
    scope.ctx.tools.guard(exec => exec.name === SELECTION_READ_CONTEXT_TOOL_NAME ? 'selection access denied by test policy' : undefined)
    const observed: ToolExecutionResult[] = []
    scope.ctx.on('tools/result', (_exec, result) => { observed.push(result) })

    const result = await execute(fixture, agent, SELECTION_READ_CONTEXT_TOOL_NAME, callId, { scope: 'selection' })

    expect(result).toMatchObject({
      isError: true,
      error: { message: 'selection access denied by test policy' },
    })
    expect(result.content).not.toContainEqual({ type: 'text', text: 'Policy must prevent this read.' })
    expect(observed).toEqual([result])
  })

  it('removes both selection tools when the Agent scope reaches quiescent disposal', async () => {
    const fixture = mount()
    const callId = nextCallId('disposed-read')
    const agent = agentScope(fixture, 'agent-disposed', [
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-disposed', material('snapshot-disposed', 'Disposed material.')),
      toolCall(3, 1, callId),
    ])
    const scope = fixture.scopes.at(-1)
    if (scope === undefined) throw new Error('fixture did not retain the Agent scope')

    expect(fixture.ctx.tools.schemas(agent).map(schema => schema.name).sort()).toEqual([
      SELECTION_CURRENT_TOOL_NAME,
      SELECTION_READ_CONTEXT_TOOL_NAME,
    ])
    await scope.dispose()

    expect(fixture.ctx.tools.schemas(agent)).toEqual([])
    await expect(execute(fixture, agent, SELECTION_READ_CONTEXT_TOOL_NAME, callId, { scope: 'selection' }))
      .resolves.toMatchObject({ isError: true, error: { info: { code: 'UNKNOWN_TOOL' } } })
  })

  it('publishes an aborted result before a cancelled call can inspect selected material', async () => {
    const fixture = mount()
    const callId = nextCallId('cancelled-read')
    const agent = agentScope(fixture, 'agent-cancelled', [
      event(1, 'turn/start', { turn: 1 }),
      selectionMessage(2, 'request-cancelled', material('snapshot-cancelled', 'Never leak this after cancellation.')),
      toolCall(3, 1, callId),
    ])
    const entered = deferred()
    const release = deferred()
    fixture.ctx.on('tools/pre-execute', async (_exec, next) => {
      entered.resolve()
      await release.promise
      return next()
    })
    const observed: ToolExecutionResult[] = []
    fixture.ctx.on('tools/result', (_exec, result) => { observed.push(result) })
    const controller = new AbortController()
    const pending = execute(fixture, agent, SELECTION_READ_CONTEXT_TOOL_NAME, callId, { scope: 'selection' }, controller.signal)
    await entered.promise
    controller.abort('cancel test')
    release.resolve()

    const result = await pending

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } },
    })
    expect(result.content).not.toContainEqual({ type: 'text', text: 'Never leak this after cancellation.' })
    expect(observed).toEqual([result])
  })
})
