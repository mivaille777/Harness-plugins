import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { dshInvocation, EXIT_CODES, exitCodeForStatus, isOwnedPath, redactOutput } from './r07-runner.mjs'

test('R07 runner keeps the three exit states explicit', () => {
  assert.equal(exitCodeForStatus('PASS'), EXIT_CODES.PASS)
  assert.equal(exitCodeForStatus('FAIL'), EXIT_CODES.FAIL)
  assert.equal(exitCodeForStatus('NOT RUN'), EXIT_CODES.NOT_RUN)
})

test('R07 runner rejects cleanup outside its owned root', () => {
  assert.equal(isOwnedPath('C:/temp/r07-run', 'C:/temp/r07-run/artifacts/report.json'), true)
  assert.equal(isOwnedPath('C:/temp/r07-run', 'C:/temp/other'), false)
  assert.equal(isOwnedPath('C:/temp/r07-run', 'C:/temp/r07-runner'), false)
})

test('R07 runner redacts credential-shaped diagnostics', () => {
  const safe = redactOutput('Authorization: Bearer sk-secret-value DEEPSEEK_API_KEY=sk-other-value')
  assert.equal(safe.includes('sk-secret-value'), false)
  assert.equal(safe.includes('sk-other-value'), false)
  assert.match(safe, /\[redacted\]/)
})

test('R07 runner can launch dsh from an explicit source checkout', () => {
  const repository = resolve('fixtures', 'deepseek harness')
  const invocation = dshInvocation(['--version'], { R07_DSH_REPOSITORY: repository })
  const renderedArgs = invocation.args.join(' ')
  assert.match(renderedArgs, /--dir/)
  assert.ok(renderedArgs.includes(repository))
  assert.match(renderedArgs, /dsh/)
  assert.match(renderedArgs, /--version/)
  assert.equal(invocation.windowsVerbatimArguments, process.platform === 'win32')
  assert.throws(
    () => dshInvocation(['--version'], { R07_DSH_REPOSITORY: ' ' }),
    /must not be empty/,
  )
})
