import { access, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const RELEASE_SCHEMA_VERSION = 1
export const REQUIRED_SCRIPTS = [
  'check',
  'test:context-expansion',
  'test:ui:a11y',
  'test:ui:visual',
  'test:perf',
  'test:human-factors:fixtures',
  'report:human-factors',
  'test:installer',
  'test:session:e2e',
  'test:lens:e2e',
]
export const REQUIRED_EVIDENCE = [
  'docs/evidence/r04-session-bound-selection-tools.md',
  'docs/evidence/r06-session-history-implementation.md',
  'docs/evidence/r07-session-e2e.md',
  'docs/evidence/r08-context-expansion.md',
  'docs/evidence/r08-ui.md',
  'docs/evidence/r08-performance-human-factors.md',
  'docs/evidence/r08-installer.md',
]
const SHA_PATTERN = /^[0-9a-f]{40}$/
const EVIDENCE_STATUSES = new Set(['PASS', 'FAIL', 'NOT RUN', 'DESCRIPTIVE_ONLY', 'PENDING'])

/** Read the current candidate SHA from git without changing the worktree. */
export function currentCandidateSha(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Validate a release manifest against the current checkout and repository inventory. */
export async function validateReleaseManifest(manifest, { root, candidateSha } = {}) {
  const issues = []
  const warnings = []
  if (!isRecord(manifest) || manifest.schemaVersion !== RELEASE_SCHEMA_VERSION) issues.push('unsupported release manifest schema')
  if (!isRecord(manifest) || typeof manifest.candidateSha !== 'string' || !SHA_PATTERN.test(manifest.candidateSha)) issues.push('manifest candidateSha must be a 40-character git SHA')
  if (candidateSha !== undefined && manifest?.candidateSha !== candidateSha) issues.push('manifest candidateSha does not match the requested candidate')
  if (!isRecord(manifest) || typeof manifest.pluginVersion !== 'string' || manifest.pluginVersion.trim() === '') issues.push('manifest pluginVersion is required')
  if (!isRecord(manifest) || manifest.protocolVersion !== 3) issues.push('manifest protocolVersion must be 3')
  if (!isRecord(manifest) || !Array.isArray(manifest.checks)) issues.push('manifest checks must be an array')
  else {
    const result = validateChecks(manifest.checks)
    issues.push(...result.issues)
    warnings.push(...result.warnings)
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.evidence)) issues.push('manifest evidence must be an array')
  else {
    const evidencePaths = new Set()
    for (const item of manifest.evidence) {
      if (!isRecord(item) || typeof item.path !== 'string' || typeof item.status !== 'string') {
        issues.push('each evidence item needs path and status')
        continue
      }
      if (evidencePaths.has(item.path)) issues.push(`duplicate evidence path: ${item.path}`)
      evidencePaths.add(item.path)
      if (!EVIDENCE_STATUSES.has(item.status)) issues.push(`unsupported evidence status: ${item.status}`)
      if (item.status === 'FAIL') issues.push(`evidence failed: ${item.path}`)
    }
    for (const path of REQUIRED_EVIDENCE) {
      const item = manifest.evidence.find(candidate => candidate.path === path)
      if (item === undefined) issues.push(`required evidence is missing from manifest: ${path}`)
      else if (item.status === 'NOT RUN' || item.status === 'PENDING' || item.status === 'DESCRIPTIVE_ONLY') warnings.push(`evidence is not a release PASS: ${path} (${item.status})`)
    }
  }
  if (!isRecord(manifest) || !Array.isArray(manifest.artifacts)) issues.push('manifest artifacts must be an array')
  if (root !== undefined) {
    let packageJson
    try {
      packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    } catch (error) {
      issues.push(`package.json could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const script of REQUIRED_SCRIPTS) {
      if (typeof packageJson?.scripts?.[script] !== 'string') issues.push(`required package script is missing: ${script}`)
    }
    for (const path of REQUIRED_EVIDENCE) {
      try { await access(join(root, path)) } catch { issues.push(`required evidence file is missing: ${path}`) }
    }
  }
  const status = issues.length > 0 ? 'FAIL' : warnings.length > 0 ? 'NOT READY' : 'READY'
  return { status, issues, warnings }
}

/** Build a manifest skeleton from the current repository without claiming release readiness. */
export async function createManifestSkeleton(root, candidateSha = currentCandidateSha(root)) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    candidateSha,
    pluginVersion: packageJson.version,
    protocolVersion: 3,
    checks: REQUIRED_SCRIPTS.map(command => ({ command, status: 'PENDING', exitCode: null })),
    evidence: REQUIRED_EVIDENCE.map(path => ({ path, status: 'PENDING' })),
    artifacts: [],
    supportMatrix: [
      { platform: 'Windows 10/11', browser: 'Chrome/Edge', status: 'DECLARED; real acceptance pending' },
    ],
    limitations: [
      'Real model, host interaction, visible-window, browser-selection, installer, and human-factors evidence must be added before READY.',
      'Translation is outside the product scope.',
    ],
  }
}

function validateChecks(checks) {
  const issues = []
  const warnings = []
  const seen = new Set()
  for (const check of checks) {
    if (!isRecord(check) || typeof check.command !== 'string' || typeof check.status !== 'string') {
      issues.push('each check needs command and status')
      continue
    }
    if (seen.has(check.command)) issues.push(`duplicate check command: ${check.command}`)
    seen.add(check.command)
    if (!REQUIRED_SCRIPTS.includes(check.command)) issues.push(`unknown check command: ${check.command}`)
    if (!EVIDENCE_STATUSES.has(check.status) && check.status !== 'PENDING') issues.push(`unsupported check status: ${check.status}`)
    if (check.status === 'PASS' && check.exitCode !== 0) issues.push(`passing check must have exitCode 0: ${check.command}`)
    if (check.status === 'FAIL') issues.push(`check failed: ${check.command}`)
    if (check.status === 'NOT RUN' || check.status === 'PENDING' || check.status === 'DESCRIPTIVE_ONLY') warnings.push(`check is not a release PASS: ${check.command} (${check.status})`)
  }
  for (const command of REQUIRED_SCRIPTS) if (!seen.has(command)) issues.push(`required check is missing: ${command}`)
  return { issues, warnings }
}

function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
