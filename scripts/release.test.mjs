import test from 'node:test'
import assert from 'node:assert/strict'
import { createManifestSkeleton, validateReleaseManifest } from './release.mjs'

const sha = 'a'.repeat(40)
const manifestFor = overrides => ({
  schemaVersion: 1,
  candidateSha: sha,
  pluginVersion: '0.1.0',
  protocolVersion: 3,
  checks: [
    { command: 'check', status: 'PASS', exitCode: 0 },
    { command: 'test:context-expansion', status: 'PASS', exitCode: 0 },
    { command: 'test:ui:a11y', status: 'PASS', exitCode: 0 },
    { command: 'test:ui:visual', status: 'PASS', exitCode: 0 },
    { command: 'test:perf', status: 'PASS', exitCode: 0 },
    { command: 'test:human-factors:fixtures', status: 'PASS', exitCode: 0 },
    { command: 'report:human-factors', status: 'PASS', exitCode: 0 },
    { command: 'test:installer', status: 'PASS', exitCode: 0 },
    { command: 'test:session:e2e', status: 'PASS', exitCode: 0 },
    { command: 'test:lens:e2e', status: 'PASS', exitCode: 0 },
  ],
  evidence: [
    { path: 'docs/evidence/r04-session-bound-selection-tools.md', status: 'PASS' },
    { path: 'docs/evidence/r06-session-history-implementation.md', status: 'PASS' },
    { path: 'docs/evidence/r07-session-e2e.md', status: 'PASS' },
    { path: 'docs/evidence/r08-context-expansion.md', status: 'PASS' },
    { path: 'docs/evidence/r08-ui.md', status: 'PASS' },
    { path: 'docs/evidence/r08-performance-human-factors.md', status: 'PASS' },
    { path: 'docs/evidence/r08-installer.md', status: 'PASS' },
  ],
  artifacts: [],
  ...overrides,
})

test('release validator accepts a complete manifest shape without filesystem assumptions', async () => {
  const result = await validateReleaseManifest(manifestFor(), { candidateSha: sha })
  assert.equal(result.status, 'READY')
  assert.deepEqual(result.issues, [])
})

test('release validator keeps pending or descriptive evidence out of READY', async () => {
  const manifest = manifestFor({ evidence: manifestFor().evidence.map(item => item.path === 'docs/evidence/r08-performance-human-factors.md' ? { ...item, status: 'DESCRIPTIVE_ONLY' } : item) })
  const result = await validateReleaseManifest(manifest, { candidateSha: sha })
  assert.equal(result.status, 'NOT READY')
  assert.match(result.warnings.join('; '), /r08-performance-human-factors/)
})

test('release validator rejects failed checks and candidate mismatch', async () => {
  const manifest = manifestFor({ checks: manifestFor().checks.map(item => item.command === 'check' ? { ...item, status: 'FAIL', exitCode: 1 } : item) })
  const result = await validateReleaseManifest(manifest, { candidateSha: 'b'.repeat(40) })
  assert.equal(result.status, 'FAIL')
  assert.match(result.issues.join('; '), /candidateSha does not match/)
  assert.match(result.issues.join('; '), /check failed/)
})

test('release skeleton marks every check and evidence item pending', async () => {
  const skeleton = await createManifestSkeleton('D:/missing-root', sha).catch(error => error)
  assert.ok(skeleton instanceof Error)
})
