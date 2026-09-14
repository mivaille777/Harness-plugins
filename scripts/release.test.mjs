import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifestSkeleton, validateReleaseManifest } from './release.mjs'

const sha = 'a'.repeat(40)
const manifestFor = overrides => ({
  schemaVersion: 1,
  candidateSha: sha,
  pluginVersion: '0.1.0',
  protocolVersion: 3,
  compatibility: { node: '^22.19.0 || >=24.0.0', harnessPackages: { '@deepseek-ai/dsh-agent': '^0.1.1-rc.2' } },
  checks: [
    { command: 'check', status: 'PASS', exitCode: 0 },
    { command: 'test:context-expansion', status: 'PASS', exitCode: 0 },
    { command: 'test:ui:a11y', status: 'PASS', exitCode: 0 },
    { command: 'test:ui:visual', status: 'PASS', exitCode: 0 },
    { command: 'test:perf', status: 'PASS', exitCode: 0 },
    { command: 'test:human-factors:fixtures', status: 'PASS', exitCode: 0 },
    { command: 'report:human-factors', status: 'PASS', exitCode: 0 },
    { command: 'test:installer', status: 'PASS', exitCode: 0 },
    { command: 'test:installer:smoke', status: 'PASS', exitCode: 0 },
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
  artifacts: [
    { kind: 'npm-bundle', path: 'candidate.tgz', sha256: 'b'.repeat(64), bytes: 10 },
    { kind: 'windows-installer', path: 'candidate-setup.exe', sha256: 'c'.repeat(64), bytes: 20 },
  ],
  supportMatrix: [{ platform: 'Windows 11', browser: 'Chrome', status: 'PASS' }],
  limitations: ['Unsigned development candidate.'],
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

test('release validator rejects missing required checks and artifacts', async () => {
  const manifest = manifestFor({
    checks: manifestFor().checks.filter(item => item.command !== 'test:installer:smoke'),
    artifacts: manifestFor().artifacts.filter(item => item.kind !== 'windows-installer'),
  })
  const result = await validateReleaseManifest(manifest, { candidateSha: sha })
  assert.equal(result.status, 'FAIL')
  assert.match(result.issues.join('; '), /required check is missing: test:installer:smoke/)
  assert.match(result.issues.join('; '), /required artifact is missing: windows-installer/)
})

test('release validator checks artifact bytes and hashes against the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-test-'))
  await mkdir(join(root, 'docs', 'evidence'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    version: '0.1.0',
    engines: { node: '^22.19.0 || >=24.0.0' },
    peerDependencies: { '@deepseek-ai/dsh-agent': '^0.1.1-rc.2' },
    scripts: Object.fromEntries(manifestFor().checks.map(check => [check.command, 'true'])),
  }))
  for (const evidence of manifestFor().evidence) await writeFile(join(root, evidence.path), 'evidence')
  const npmBytes = Buffer.from('npm bundle')
  const installerBytes = Buffer.from('installer')
  await writeFile(join(root, 'candidate.tgz'), npmBytes)
  await writeFile(join(root, 'candidate-setup.exe'), installerBytes)
  const manifest = manifestFor({ artifacts: [
    { kind: 'npm-bundle', path: 'candidate.tgz', sha256: createHash('sha256').update(npmBytes).digest('hex'), bytes: npmBytes.length },
    { kind: 'windows-installer', path: 'candidate-setup.exe', sha256: createHash('sha256').update(installerBytes).digest('hex'), bytes: installerBytes.length },
  ] })
  const passing = await validateReleaseManifest(manifest, { root, candidateSha: sha })
  assert.equal(passing.status, 'READY')
  manifest.artifacts[1].sha256 = '0'.repeat(64)
  const failing = await validateReleaseManifest(manifest, { root, candidateSha: sha })
  assert.match(failing.issues.join('; '), /sha256 does not match/)
})

test('release validator rejects package and Harness compatibility drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-version-test-'))
  await mkdir(join(root, 'docs', 'evidence'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({
    version: '0.2.0',
    engines: { node: '>=24' },
    peerDependencies: { '@deepseek-ai/dsh-agent': '^0.2.0' },
    scripts: Object.fromEntries(manifestFor().checks.map(check => [check.command, 'true'])),
  }))
  for (const evidence of manifestFor().evidence) await writeFile(join(root, evidence.path), 'evidence')
  const npmBytes = Buffer.alloc(10)
  const installerBytes = Buffer.alloc(20)
  await writeFile(join(root, 'candidate.tgz'), npmBytes)
  await writeFile(join(root, 'candidate-setup.exe'), installerBytes)
  const manifest = manifestFor({ artifacts: [
    { kind: 'npm-bundle', path: 'candidate.tgz', sha256: createHash('sha256').update(npmBytes).digest('hex'), bytes: npmBytes.length },
    { kind: 'windows-installer', path: 'candidate-setup.exe', sha256: createHash('sha256').update(installerBytes).digest('hex'), bytes: installerBytes.length },
  ] })
  const result = await validateReleaseManifest(manifest, { root, candidateSha: sha })
  assert.equal(result.status, 'FAIL')
  assert.match(result.issues.join('; '), /pluginVersion does not match/)
  assert.match(result.issues.join('; '), /Node compatibility does not match/)
  assert.match(result.issues.join('; '), /Harness compatibility does not match/)
})

test('release skeleton marks every check and evidence item pending', async () => {
  const skeleton = await createManifestSkeleton('D:/missing-root', sha).catch(error => error)
  assert.ok(skeleton instanceof Error)
})
