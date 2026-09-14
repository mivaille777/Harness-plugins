import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  EC09_DRIVER_SCHEMA_VERSION,
  exitCodeForLensStatus,
  parseDriverArgs,
  requiredStates,
  resolveScreenshotPath,
  validateDriverReport,
} from './test-lens-e2e.mjs'

const REQUIRED_ASSERTIONS = [
  'browser-selection-captured',
  'expanded-context-loaded',
  'expanded-scope-authorized',
  'request-material-matches-authorization',
  'session-transcript-observed',
]

function validDriverReport() {
  return {
    schemaVersion: EC09_DRIVER_SCHEMA_VERSION,
    status: 'PASS',
    application: 'tauri',
    realWindow: true,
    realSelection: true,
    browser: 'edge',
    states: ['idle', 'authorized', 'material', 'streaming', 'history'],
    assertions: [...REQUIRED_ASSERTIONS],
    contextAuthorization: {
      requestedScope: 'page',
      authorizedScope: 'page',
      actualScope: 'page',
      materialScope: 'page',
      snapshotId: 'snapshot-ec09',
      revision: 9,
      previewMatchesMaterial: true,
      requestMaterialFrozen: true,
    },
    sessionEvidence: {
      requestId: 'request-ec09',
      transcriptSource: 'dsh-session',
      transcriptObserved: true,
      requestMaterialObserved: true,
      transcriptContainsAuthorizedContext: true,
      materialSnapshotId: 'snapshot-ec09',
      materialRevision: 9,
    },
    screenshots: [
      { state: 'idle', path: 'idle.png' },
      { state: 'authorized', path: 'authorized.png' },
      { state: 'material', path: 'material.png' },
      { state: 'streaming', path: 'streaming.png' },
      { state: 'history', path: 'history.png' },
    ],
  }
}

async function createScreenshots() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-selection-companion-lens-test-'))
  const screenshots = join(root, 'screenshots')
  await mkdir(screenshots, { recursive: true })
  for (const state of ['idle', 'authorized', 'material', 'streaming', 'history']) {
    await writeFile(join(screenshots, `${state}.png`), Buffer.from([1, 2, 3]))
  }
  return screenshots
}

test('Lens runner preserves explicit PASS, FAIL, and NOT RUN exit states', () => {
  assert.equal(exitCodeForLensStatus('PASS'), 0)
  assert.equal(exitCodeForLensStatus('FAIL'), 1)
  assert.equal(exitCodeForLensStatus('NOT RUN'), 2)
})

test('Lens runner parses only JSON string argument arrays', () => {
  assert.deepEqual(parseDriverArgs('["--fixture","capture-windows.html"]'), ['--fixture', 'capture-windows.html'])
  assert.deepEqual(parseDriverArgs(undefined), [])
  assert.throws(() => parseDriverArgs('{"shell":true}'), /JSON array/)
  assert.throws(() => parseDriverArgs('["ok",1]'), /array of strings/)
})

test('Lens runner keeps EC-09 states and screenshot paths inside the fixture directory', () => {
  assert.deepEqual(requiredStates('material,custom'), ['idle', 'authorized', 'material', 'streaming', 'history', 'custom'])
  assert.equal(resolveScreenshotPath('C:/tmp/lens', 'idle.png'), 'C:\\tmp\\lens\\idle.png')
  assert.equal(resolveScreenshotPath('C:/tmp/lens', '../outside.png'), null)
})

test('Lens runner rejects a static or incomplete driver report', async () => {
  const screenshots = await createScreenshots()
  const result = await validateDriverReport({
    schemaVersion: EC09_DRIVER_SCHEMA_VERSION,
    status: 'PASS',
    application: 'browser',
    realWindow: false,
    realSelection: false,
    browser: 'chrome',
    states: ['idle'],
    assertions: ['browser-selection-captured'],
    screenshots: [{ state: 'idle', path: 'idle.png' }],
  }, screenshots, requiredStates())
  assert.equal(result.ok, false)
  assert.match(result.reason, /real Tauri window/)
})

test('Lens runner rejects authorization evidence that does not match submitted material scope', async () => {
  const screenshots = await createScreenshots()
  const report = validDriverReport()
  report.contextAuthorization.materialScope = 'selection'
  const result = await validateDriverReport(report, screenshots, requiredStates())
  assert.equal(result.ok, false)
  assert.match(result.reason, /material scope/)
})

test('Lens runner rejects Session evidence bound to a different snapshot identity', async () => {
  const screenshots = await createScreenshots()
  const report = validDriverReport()
  report.sessionEvidence.materialSnapshotId = 'snapshot-other'
  const result = await validateDriverReport(report, screenshots, requiredStates())
  assert.equal(result.ok, false)
  assert.match(result.reason, /snapshotId/)
})

test('Lens runner requires one owned screenshot for every required EC-09 state', async () => {
  const screenshots = await createScreenshots()
  const report = validDriverReport()
  report.screenshots = report.screenshots.filter(item => item.state !== 'authorized')
  const result = await validateDriverReport(report, screenshots, requiredStates())
  assert.equal(result.ok, false)
  assert.match(result.reason, /screenshots for states: authorized/)
})

test('Lens runner validates expanded authorization, Session identity, states, and PNG evidence', async () => {
  const screenshots = await createScreenshots()
  const result = await validateDriverReport(validDriverReport(), screenshots, requiredStates())
  assert.equal(result.ok, true)
  assert.equal(result.screenshots.length, 5)
  assert.equal(result.contextAuthorization.authorizedScope, 'page')
  assert.equal(result.contextAuthorization.materialScope, 'page')
  assert.equal(result.sessionEvidence.requestId, 'request-ec09')
  assert.equal(result.sessionEvidence.materialSnapshotId, 'snapshot-ec09')
})
