import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

describe('Harness runtime diagnostics contract', () => {
  it('checks Loader composition and existing Protocol V4 runtime surfaces', async () => {
    const source = await readFile(resolve('scripts/diagnose-harness.mjs'), 'utf8')
    expect(source).toContain('selection-context')
    expect(source).toContain('selection-sessions')
    expect(source).toContain('selection-bridge')
    expect(source).toContain("'bridge.hello'")
    expect(source).toContain("'bridge.ping'")
    expect(source).toContain("'session.list'")
    expect(source).toContain("'selection.current'")
    expect(source).toContain('[READY] Selection Companion Harness runtime is healthy.')
  })
})
