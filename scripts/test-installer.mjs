import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { buildDiagnosticReport, describeArtifacts, findInstallerArtifacts, readInstallerMetadata, validateInstallerMetadata } from './installer.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadata = await readInstallerMetadata(root)
const issues = await validateInstallerMetadata(metadata)
const candidateSha = process.env.R08_CANDIDATE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const artifacts = await findInstallerArtifacts(metadata.artifactDirectory)
const diagnostic = buildDiagnosticReport({
  metadata,
  candidateSha,
  bridge: { connected: false, lastErrorCode: issues.length === 0 ? null : 'INSTALLER_METADATA_INVALID' },
  capture: { phase: 'unknown', paused: false, metrics: {} },
  errors: issues,
})
const manifest = {
  schemaVersion: 1,
  candidateSha,
  versions: { plugin: metadata.packageVersion, native: metadata.nativeVersion, tauri: metadata.tauriVersion, protocol: 4 },
  bundleActive: metadata.bundleActive,
  artifacts: metadata.bundleActive ? await describeArtifacts(metadata.artifactDirectory, artifacts) : [],
  diagnostic,
}
const output = process.env.R08_INSTALLER_MANIFEST === undefined
  ? join(tmpdir(), `dsh-selection-companion-installer-${Date.now()}.json`)
  : resolve(process.env.R08_INSTALLER_MANIFEST)
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
if (issues.length > 0) {
  console.error(JSON.stringify({ status: 'FAIL', output, issues }))
  process.exitCode = 1
} else if (!metadata.bundleActive || artifacts.length === 0) {
  console.log(JSON.stringify({ status: 'NOT RUN', output, reason: 'Tauri bundle is inactive or no installer artifact exists; a clean Windows install environment is required.' }))
  process.exitCode = 2
} else {
  console.log(JSON.stringify({ status: 'READY FOR ISOLATED INSTALL', output, artifacts: manifest.artifacts }))
}
