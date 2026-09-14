import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionSnapshot } from '../../../src/context/snapshot.js'
import type { SelectionMaterial } from '../../../src/session/material.js'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))

import {
  SubmissionUnknownError,
  createSession,
  expandSelection,
  listSessions,
  readSessionHistory,
  submitSessionPrompt,
  unsubscribeSession,
} from './bridge'

const material: SelectionSnapshot = {
  id: 'snapshot-1',
  revision: 7,
  capturedAt: 1_725_753_600_000,
  selection: { text: 'Fixed selected material', language: 'en' },
  source: { kind: 'browser', app: 'Chrome', windowTitle: 'Fixture page' },
  document: { title: 'Fixture page', url: 'https://example.test/fixed' },
  context: { pageAvailable: false },
  capabilities: { localContext: false, sectionContext: false, pageContext: false, screenshot: false },
  provider: 'test-provider',
  confidence: 1,
}

const authorizedMaterial: SelectionMaterial = {
  snapshotId: 'snapshot-1',
  revision: 7,
  capturedAt: 1_725_753_600_000,
  selection: { text: 'Fixed selected material', language: 'en' },
  source: { kind: 'browser', app: 'Chrome', windowTitle: 'Fixture page' },
  document: { title: 'Fixture page', url: 'https://example.test/fixed' },
  authorizedScope: 'local',
  actualScope: 'local',
  completeness: 'complete',
  truncated: false,
  context: { before: 'Authorized before', after: 'Authorized after' },
}

describe('submitSessionPrompt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the legacy fixed snapshot fallback for existing callers', async () => {
    tauri.invoke.mockResolvedValue({
      sessionId: 'session-1',
      requestId: 'request-1',
      messageId: 'message-1',
      delivery: 'queued',
      duplicate: false,
    })
    await submitSessionPrompt('session-1', 'prompt', 'request-1', material)
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_submit_prompt', {
      sessionId: 'session-1',
      content: 'prompt',
      requestId: 'request-1',
      material,
    })
    expect((tauri.invoke.mock.calls[0]?.[1] as { material?: unknown }).material).toBe(material)
  })

  it('prefers the canonical authorized material when Lens supplies it', async () => {
    tauri.invoke.mockResolvedValue({
      sessionId: 'session-1',
      requestId: 'request-1',
      messageId: 'message-1',
      delivery: 'queued',
      duplicate: false,
    })
    await submitSessionPrompt('session-1', 'prompt', 'request-1', material, authorizedMaterial)
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_submit_prompt', {
      sessionId: 'session-1',
      content: 'prompt',
      requestId: 'request-1',
      material: authorizedMaterial,
    })
    expect((tauri.invoke.mock.calls[0]?.[1] as { material?: unknown }).material).toBe(authorizedMaterial)
  })

  it('preserves session and request identity when the submit reply is unknown', async () => {
    tauri.invoke.mockRejectedValue('SUBMISSION_UNKNOWN|session-1|request-1|pipe closed')
    const failure = await submitSessionPrompt('session-1', 'prompt', 'request-1', material, authorizedMaterial).catch(error => error)
    expect(failure).toBeInstanceOf(SubmissionUnknownError)
    expect(failure).toMatchObject({ sessionId: 'session-1', requestId: 'request-1', message: 'pipe closed' })
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_submit_prompt', {
      sessionId: 'session-1',
      content: 'prompt',
      requestId: 'request-1',
      material: authorizedMaterial,
    })
  })
})

describe('session bridge commands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists sessions through the Rust command without rewriting fields', async () => {
    const sessions = [{ id: 'session-1', title: 'Fixed title', status: 'idle', createdAt: 12, live: true, persisted: true }]
    tauri.invoke.mockResolvedValue(sessions)
    await expect(listSessions()).resolves.toEqual(sessions)
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_list_sessions')
  })

  it('creates a session with an optional working directory', async () => {
    tauri.invoke.mockResolvedValue('session-created')
    await expect(createSession('D:/fixture')).resolves.toBe('session-created')
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_create_session', { cwd: 'D:/fixture' })
    tauri.invoke.mockClear()
    await expect(createSession()).resolves.toBe('session-created')
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_create_session')
  })

  it('reads paged history and releases an exact subscription', async () => {
    const page = { sessionId: 'session-1', nextCursor: 9, capturedThroughCursor: 12, entries: [{ seq: 9, time: 10, role: 'assistant', text: 'Answer' }] }
    tauri.invoke.mockResolvedValueOnce(page).mockResolvedValueOnce({ sessionId: 'session-1', subscriptionId: 'sub-1', released: true })
    await expect(readSessionHistory('session-1', 4, 5)).resolves.toEqual(page)
    expect(tauri.invoke).toHaveBeenNthCalledWith(1, 'bridge_read_session_history', { sessionId: 'session-1', afterCursor: 4, limit: 5 })
    await expect(unsubscribeSession('session-1', 'sub-1')).resolves.toEqual({ sessionId: 'session-1', subscriptionId: 'sub-1', released: true })
    expect(tauri.invoke).toHaveBeenNthCalledWith(2, 'bridge_unsubscribe_session', { sessionId: 'session-1', subscriptionId: 'sub-1' })
  })
})

describe('selection context bridge commands', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requests an explicit bounded expansion for the fixed snapshot', async () => {
    const expansion = {
      snapshotId: 'snapshot-1',
      scope: 'local' as const,
      revision: 7,
      completeness: 'complete' as const,
      truncated: false,
      context: { before: 'Before', after: 'After' },
    }
    tauri.invoke.mockResolvedValue(expansion)
    await expect(expandSelection('snapshot-1', 'local')).resolves.toEqual(expansion)
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_expand_selection', { snapshotId: 'snapshot-1', scope: 'local' })
  })
})
