import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Harness runtime diagnostics contract', () => {
  it('is valid executable JavaScript', () => {
    const script = resolve('scripts/diagnose-harness.mjs')
    const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  })

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
