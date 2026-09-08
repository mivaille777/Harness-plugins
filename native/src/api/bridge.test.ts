import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionSnapshot } from '../../../src/context/snapshot.js'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))

import { SubmissionUnknownError, submitSessionPrompt } from './bridge'

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

describe('submitSessionPrompt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the caller-generated identity and fixed snapshot to Rust', async () => {
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
    expect(tauri.invoke.mock.calls[0]?.[1]).toMatchObject({ material })
    expect((tauri.invoke.mock.calls[0]?.[1] as { material?: unknown }).material).toBe(material)
  })

  it('preserves session and request identity when the submit reply is unknown', async () => {
    tauri.invoke.mockRejectedValue('SUBMISSION_UNKNOWN|session-1|request-1|pipe closed')
    const failure = await submitSessionPrompt('session-1', 'prompt', 'request-1', material).catch(error => error)
    expect(failure).toBeInstanceOf(SubmissionUnknownError)
    expect(failure).toMatchObject({ sessionId: 'session-1', requestId: 'request-1', message: 'pipe closed' })
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_submit_prompt', {
      sessionId: 'session-1',
      content: 'prompt',
      requestId: 'request-1',
      material,
    })
  })
})
