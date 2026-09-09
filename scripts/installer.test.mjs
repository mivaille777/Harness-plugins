import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDiagnosticReport, redactDiagnostic, validateInstallerMetadata } from './installer.mjs'

test('installer metadata validator catches version drift and missing icon', async () => {
  const issues = await validateInstallerMetadata({
    packageVersion: '0.1.0',
    nativeVersion: '0.2.0',
    tauriVersion: '0.1.0',
    identifier: 'io.github.mivaille777.dsh-selection-companion',
    bundleActive: false,
    bundleTargets: ['msi'],
    installMode: 'perMachine',
    frontendDist: '../dist',
    beforeBuildCommand: 'pnpm build',
    iconPath: 'C:/path/that/does/not/exist.ico',
  })
  assert.match(issues.join('; '), /versions must match/)
  assert.match(issues.join('; '), /bundle must be active/)
  assert.match(issues.join('; '), /only the NSIS target/)
  assert.match(issues.join('; '), /install mode must be currentUser/)
  assert.match(issues.join('; '), /icon.ico is missing/)
})

test('installer metadata accepts the supported per-user NSIS candidate', async () => {
  const issues = await validateInstallerMetadata({
    packageVersion: '0.1.0',
    nativeVersion: '0.1.0',
    tauriVersion: '0.1.0',
    identifier: 'io.github.mivaille777.dsh-selection-companion',
    bundleActive: true,
    bundleTargets: ['nsis'],
    installMode: 'currentUser',
    frontendDist: '../dist',
    beforeBuildCommand: 'pnpm build',
    iconPath: new URL('../native/src-tauri/icons/icon.ico', import.meta.url),
  })
  assert.deepEqual(issues, [])
})

test('diagnostic redaction removes selected material and credential-shaped fields', () => {
  const redacted = redactDiagnostic({ selection: 'secret', nested: { url: 'https://private.test', token: 'secret-token', phase: 'error' } })
  assert.deepEqual(redacted, { selection: '[redacted]', nested: { url: '[redacted]', token: '[redacted]', phase: 'error' } })
})

test('diagnostic report requires a candidate SHA and exposes only operational fields', () => {
  const metadata = { packageVersion: '0.1.0', nativeVersion: '0.1.0' }
  assert.throws(() => buildDiagnosticReport({ metadata, candidateSha: 'bad', bridge: {}, capture: {} }), /candidateSha/)
  const report = buildDiagnosticReport({ metadata, candidateSha: 'a'.repeat(40), bridge: { connected: true }, capture: { phase: 'running', paused: false, metrics: { captured: 1 } }, errors: [{ text: 'secret' }] })
  assert.equal(report.status, 'DIAGNOSTIC_ONLY')
  assert.equal(report.errors[0].text, '[redacted]')
})
