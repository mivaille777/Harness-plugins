import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  exitCodeForLensStatus,
  parseDriverArgs,
  requiredStates,
  resolveScreenshotPath,
  validateDriverReport,
} from './test-lens-e2e.mjs'

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

test('Lens runner keeps required states and screenshot paths inside the fixture directory', () => {
  assert.deepEqual(requiredStates('material,custom'), ['idle', 'material', 'streaming', 'history', 'custom'])
  assert.equal(resolveScreenshotPath('C:/tmp/lens', 'idle.png'), 'C:\\tmp\\lens\\idle.png')
  assert.equal(resolveScreenshotPath('C:/tmp/lens', '../outside.png'), null)
})

test('Lens runner rejects a static or incomplete driver report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-selection-companion-lens-test-'))
  const screenshots = join(root, 'screenshots')
  await mkdir(screenshots, { recursive: true })
  await writeFile(join(screenshots, 'idle.png'), Buffer.from([1]))
  const result = await validateDriverReport({
    schemaVersion: 1,
    status: 'PASS',
    application: 'browser',
    realWindow: false,
    realSelection: false,
    browser: 'chrome',
    states: ['idle'],
    assertions: ['dom'],
    screenshots: ['idle.png'],
  }, screenshots, requiredStates())
  assert.equal(result.ok, false)
  assert.match(result.reason, /real Tauri window/)
})

test('Lens runner validates real-driver report states and non-empty PNG evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-selection-companion-lens-test-'))
  const screenshots = join(root, 'screenshots')
  await mkdir(screenshots, { recursive: true })
  for (const state of ['idle', 'material', 'streaming', 'history']) {
    await writeFile(join(screenshots, `${state}.png`), Buffer.from([1, 2, 3]))
  }
  const result = await validateDriverReport({
    schemaVersion: 1,
    status: 'PASS',
    application: 'tauri',
    realWindow: true,
    realSelection: true,
    browser: 'edge',
    states: ['idle', 'material', 'streaming', 'history'],
    assertions: ['selection fixed in Lens', 'history restored after reload'],
    screenshots: ['idle.png', 'material.png', 'streaming.png', 'history.png'],
  }, screenshots, requiredStates())
  assert.equal(result.ok, true)
  assert.equal(result.screenshots.length, 4)
})
