import { beforeEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))

import { SubmissionUnknownError, submitSessionPrompt } from './bridge'

describe('submitSessionPrompt', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the caller-generated logical request id to Rust', async () => {
    tauri.invoke.mockResolvedValue({
      sessionId: 'session-1',
      requestId: 'request-1',
      messageId: 'message-1',
      delivery: 'queued',
      duplicate: false,
    })
    await submitSessionPrompt('session-1', 'prompt', 'request-1')
    expect(tauri.invoke).toHaveBeenCalledWith('bridge_submit_prompt', {
      sessionId: 'session-1',
      content: 'prompt',
      requestId: 'request-1',
    })
  })

  it('preserves session and request identity when the submit reply is unknown', async () => {
    tauri.invoke.mockRejectedValue('SUBMISSION_UNKNOWN|session-1|request-1|pipe closed')
    const failure = await submitSessionPrompt('session-1', 'prompt', 'request-1').catch(error => error)
    expect(failure).toBeInstanceOf(SubmissionUnknownError)
    expect(failure).toMatchObject({ sessionId: 'session-1', requestId: 'request-1', message: 'pipe closed' })
  })
})
