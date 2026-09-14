import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  EXIT_CODES,
  isOwnedPath,
  preflight as hostPreflight,
  redactOutput,
  removeOwnedPath,
  runProcess,
  writeReport,
} from './r07-runner.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const EC09_DRIVER_SCHEMA_VERSION = 2
const DEFAULT_REQUIRED_STATES = Object.freeze(['idle', 'authorized', 'material', 'streaming', 'history'])
const REQUIRED_EC09_ASSERTIONS = Object.freeze([
  'browser-selection-captured',
  'expanded-context-loaded',
  'expanded-scope-authorized',
  'request-material-matches-authorization',
  'session-transcript-observed',
])
const EXPANDED_SCOPES = new Set(['local', 'section', 'page'])
const DEFAULT_TIMEOUT_MS = 180_000

/** Return the process exit code for an L3 status. */
export function exitCodeForLensStatus(status) {
  if (status === 'PASS') return EXIT_CODES.PASS
  if (status === 'NOT RUN') return EXIT_CODES.NOT_RUN
  return EXIT_CODES.FAIL
}

/** Parse a JSON array of driver arguments without accepting shell syntax. */
export function parseDriverArgs(value) {
  if (value === undefined || value.trim() === '') return []
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`R07_LENS_DRIVER_ARGS must be a JSON array: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed) || parsed.some(argument => typeof argument !== 'string')) {
    throw new Error('R07_LENS_DRIVER_ARGS must be a JSON array of strings')
  }
  return parsed
}

/** Normalize the required visual states while retaining the fixed EC-09 minimum. */
export function requiredStates(value) {
  const requested = value === undefined || value.trim() === ''
    ? [...DEFAULT_REQUIRED_STATES]
    : value.split(',').map(item => item.trim()).filter(Boolean)
  return [...new Set([...DEFAULT_REQUIRED_STATES, ...requested])]
}

/** Keep a driver screenshot path inside the run-owned screenshot directory. */
export function resolveScreenshotPath(screenshotDirectory, value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const path = resolve(screenshotDirectory, value)
  return isOwnedPath(screenshotDirectory, path) ? path : null
}

function validateAuthorizationEvidence(report) {
  const evidence = report?.contextAuthorization
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { ok: false, reason: 'driver report needs contextAuthorization evidence' }
  }
  if (!EXPANDED_SCOPES.has(evidence.requestedScope)) {
    return { ok: false, reason: 'contextAuthorization.requestedScope must be local, section, or page' }
  }
  if (evidence.authorizedScope !== evidence.requestedScope) {
    return { ok: false, reason: 'authorized scope must match the explicitly requested expanded scope' }
  }
  if (evidence.actualScope !== evidence.requestedScope) {
    return { ok: false, reason: 'actual scope must match the explicitly authorized expanded scope' }
  }
  if (evidence.materialScope !== evidence.requestedScope) {
    return { ok: false, reason: 'submitted material scope must match the explicitly authorized scope' }
  }
  if (typeof evidence.snapshotId !== 'string' || evidence.snapshotId.trim() === '') {
    return { ok: false, reason: 'contextAuthorization needs a non-empty snapshotId' }
  }
  if (!Number.isInteger(evidence.revision) || evidence.revision < 0) {
    return { ok: false, reason: 'contextAuthorization needs a non-negative integer revision' }
  }
  if (evidence.previewMatchesMaterial !== true) {
    return { ok: false, reason: 'driver must prove request-material preview matches the submitted material' }
  }
  if (evidence.requestMaterialFrozen !== true) {
    return { ok: false, reason: 'driver must prove the request material was frozen before submission' }
  }
  return {
    ok: true,
    evidence: {
      requestedScope: evidence.requestedScope,
      authorizedScope: evidence.authorizedScope,
      actualScope: evidence.actualScope,
      materialScope: evidence.materialScope,
      snapshotId: evidence.snapshotId,
      revision: evidence.revision,
      previewMatchesMaterial: true,
      requestMaterialFrozen: true,
    },
  }
}

function validateSessionEvidence(report, authorization) {
  const evidence = report?.sessionEvidence
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return { ok: false, reason: 'driver report needs sessionEvidence' }
  }
  if (typeof evidence.requestId !== 'string' || evidence.requestId.trim() === '') {
    return { ok: false, reason: 'sessionEvidence needs a non-empty requestId' }
  }
  if (evidence.transcriptSource !== 'dsh-session') {
    return { ok: false, reason: 'session transcript evidence must come from dsh-session' }
  }
  if (evidence.transcriptObserved !== true) {
    return { ok: false, reason: 'driver must prove the submitted request appears in Session history' }
  }
  if (evidence.requestMaterialObserved !== true) {
    return { ok: false, reason: 'driver must prove Session evidence is tied to the submitted request material' }
  }
  if (evidence.transcriptContainsAuthorizedContext !== true) {
    return { ok: false, reason: 'driver must prove the Session transcript contains the authorized context' }
  }
  if (evidence.materialSnapshotId !== authorization.snapshotId) {
    return { ok: false, reason: 'Session material snapshotId must match the authorized request snapshot' }
  }
  if (evidence.materialRevision !== authorization.revision) {
    return { ok: false, reason: 'Session material revision must match the authorized request revision' }
  }
  return {
    ok: true,
    evidence: {
      requestId: evidence.requestId,
      transcriptSource: 'dsh-session',
      transcriptObserved: true,
      requestMaterialObserved: true,
      transcriptContainsAuthorizedContext: true,
      materialSnapshotId: evidence.materialSnapshotId,
      materialRevision: evidence.materialRevision,
    },
  }
}

/** Check the strict report written by a real Tauri/browser driver. */
export async function validateDriverReport(report, screenshotDirectory, required) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, reason: 'driver report is not an object', screenshots: [], states: [] }
  }
  if (report.schemaVersion !== EC09_DRIVER_SCHEMA_VERSION) {
    return { ok: false, reason: `driver report schemaVersion must be ${EC09_DRIVER_SCHEMA_VERSION}`, screenshots: [], states: [] }
  }
  if (report.status !== 'PASS') {
    return { ok: false, reason: 'driver report did not assert PASS', screenshots: [], states: [] }
  }
  if (report.application !== 'tauri' || report.realWindow !== true || report.realSelection !== true) {
    return { ok: false, reason: 'driver must prove a real Tauri window and browser selection', screenshots: [], states: [] }
  }
  if (!['chrome', 'edge'].includes(report.browser)) {
    return { ok: false, reason: 'driver report browser must be chrome or edge', screenshots: [], states: [] }
  }
  if (!Array.isArray(report.assertions) || report.assertions.some(item => typeof item !== 'string')) {
    return { ok: false, reason: 'driver report needs named assertions', screenshots: [], states: [] }
  }
  const missingAssertions = REQUIRED_EC09_ASSERTIONS.filter(assertion => !report.assertions.includes(assertion))
  if (missingAssertions.length > 0) {
    return { ok: false, reason: `driver report is missing required assertions: ${missingAssertions.join(', ')}`, screenshots: [], states: [] }
  }
  if (!Array.isArray(report.states) || report.states.some(item => typeof item !== 'string')) {
    return { ok: false, reason: 'driver report needs a states array', screenshots: [], states: [] }
  }
  const states = [...new Set(report.states)]
  const missing = required.filter(state => !states.includes(state))
  if (missing.length > 0) {
    return { ok: false, reason: `driver report is missing required states: ${missing.join(', ')}`, screenshots: [], states }
  }

  const authorization = validateAuthorizationEvidence(report)
  if (!authorization.ok) {
    return { ok: false, reason: authorization.reason, screenshots: [], states }
  }
  const session = validateSessionEvidence(report, authorization.evidence)
  if (!session.ok) {
    return { ok: false, reason: session.reason, screenshots: [], states }
  }

  if (!Array.isArray(report.screenshots) || report.screenshots.length === 0) {
    return { ok: false, reason: 'driver report needs state-labelled screenshot evidence', screenshots: [], states }
  }
  const screenshots = []
  const screenshotStates = new Set()
  for (const item of report.screenshots) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, reason: 'EC-09 screenshots must be objects with state and path', screenshots: [], states }
    }
    const relativePath = item.path
    const state = item.state
    if (typeof state !== 'string' || state.trim() === '') {
      return { ok: false, reason: 'each EC-09 screenshot needs a non-empty state', screenshots: [], states }
    }
    const path = resolveScreenshotPath(screenshotDirectory, relativePath)
    if (path === null || extname(path).toLowerCase() !== '.png') {
      return { ok: false, reason: 'driver screenshot paths must be owned PNG files', screenshots: [], states }
    }
    let info
    try { info = await stat(path) } catch { info = null }
    if (info === null || !info.isFile() || info.size === 0) {
      return { ok: false, reason: `driver screenshot is missing or empty: ${relativePath}`, screenshots: [], states }
    }
    screenshotStates.add(state)
    screenshots.push({ state, path, bytes: info.size, modifiedAt: info.mtime.toISOString() })
  }
  const missingScreenshotStates = required.filter(state => !screenshotStates.has(state))
  if (missingScreenshotStates.length > 0) {
    return { ok: false, reason: `driver report is missing screenshots for states: ${missingScreenshotStates.join(', ')}`, screenshots, states }
  }

  return {
    ok: true,
    reason: 'real browser/Tauri identity, expanded authorization, frozen request material, Session evidence, states, and screenshots verified',
    screenshots,
    states,
    contextAuthorization: authorization.evidence,
    sessionEvidence: session.evidence,
  }
}

/** Find PNG files below a screenshot directory for diagnostics. */
export async function listScreenshots(directory) {
  const paths = []
  async function walk(current) {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') {
        const info = await stat(path)
        if (info.size > 0) paths.push({ path, bytes: info.size, modifiedAt: info.mtime.toISOString() })
      }
    }
  }
  await walk(directory)
  return paths
}

/** Read a JSON object emitted by the interactive driver. */
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

/** Collect a commit identity without failing the UI runner when git is unavailable. */
async function gitIdentity() {
  const head = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, timeoutMs: 10_000 })
  const dirty = await runProcess('git', ['status', '--porcelain'], { cwd: repoRoot, timeoutMs: 10_000 })
  return {
    head: head.code === 0 ? head.stdout.trim() : null,
    dirty: dirty.code === 0 ? dirty.stdout.trim().length > 0 : null,
  }
}

/** Run the configured real-window driver and persist a structured L3 report. */
export async function runLensE2E(env = process.env) {
  const startedAt = new Date().toISOString()
  const artifactRoot = env.R07_LENS_ARTIFACT_ROOT === undefined
    ? join(tmpdir(), 'dsh-selection-companion-r07-reports')
    : resolve(env.R07_LENS_ARTIFACT_ROOT)
  const runRoot = resolve(tmpdir(), `dsh-selection-companion-lens-${process.pid}-${Date.now()}`)
  const screenshotDirectory = env.R07_LENS_SCREENSHOT_DIR === undefined
    ? join(artifactRoot, 'lens-screenshots')
    : resolve(env.R07_LENS_SCREENSHOT_DIR)
  const driverReportPath = env.R07_LENS_DRIVER_REPORT === undefined
    ? join(runRoot, 'driver-report.json')
    : resolve(env.R07_LENS_DRIVER_REPORT)
  const fixture = env.R07_LENS_FIXTURE === undefined
    ? join(repoRoot, 'tests', 'fixtures', 'capture-windows.html')
    : resolve(env.R07_LENS_FIXTURE)
  const required = requiredStates(env.R07_LENS_REQUIRED_STATES)
  const host = await hostPreflight(env)
  const driverCommand = env.R07_LENS_DRIVER?.trim() || null
  let driverArgs = []
  let argumentError = null
  try { driverArgs = parseDriverArgs(env.R07_LENS_DRIVER_ARGS) } catch (error) { argumentError = error instanceof Error ? error.message : String(error) }
  const preflight = {
    ...host,
    fixture,
    fixturePresent: existsSync(fixture),
    nativeDistPresent: existsSync(join(repoRoot, 'native', 'dist', 'index.html')),
    driverConfigured: driverCommand !== null,
    screenshotDirectory,
    requiredStates: required,
    driverSchemaVersion: EC09_DRIVER_SCHEMA_VERSION,
  }
  const report = {
    schemaVersion: 1,
    layer: 'L3',
    startedAt,
    repository: repoRoot,
    git: await gitIdentity(),
    preflight,
    status: 'NOT RUN',
    reason: null,
    driver: null,
    screenshots: [],
    artifacts: { report: join(artifactRoot, 'r07-lens-e2e.json'), driverReport: driverReportPath },
  }

  await mkdir(runRoot, { recursive: true })
  await mkdir(screenshotDirectory, { recursive: true })
  try {
    if (argumentError !== null) {
      report.reason = argumentError
    } else if (!preflight.windows) {
      report.reason = 'Windows is required for the Tauri and UI Automation path'
    } else if (!preflight.fixturePresent) {
      report.reason = `missing non-sensitive browser fixture: ${fixture}`
    } else if (!preflight.nativeDistPresent) {
      report.reason = 'native/dist/index.html is missing; run pnpm --dir native build before the interactive check'
    } else if (driverCommand === null) {
      report.reason = 'set R07_LENS_DRIVER and optional JSON R07_LENS_DRIVER_ARGS to run a real Tauri/browser driver'
    } else {
      const driverEnv = {
        ...env,
        DSH_LENS_FIXTURE_PATH: fixture,
        DSH_LENS_SCREENSHOT_DIR: screenshotDirectory,
        DSH_LENS_REPORT_PATH: driverReportPath,
        DSH_LENS_REQUIRED_STATES: required.join(','),
        DSH_LENS_DRIVER_SCHEMA_VERSION: String(EC09_DRIVER_SCHEMA_VERSION),
      }
      const result = await runProcess(driverCommand, driverArgs, {
        cwd: repoRoot,
        env: driverEnv,
        timeoutMs: Number(env.R07_LENS_TIMEOUT_MS) > 0 ? Number(env.R07_LENS_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS,
      })
      report.driver = {
        command: driverCommand,
        argumentCount: driverArgs.length,
        code: result.code,
        signal: result.signal,
        timedOut: result.timedOut,
        stdout: redactOutput(result.stdout).trim(),
        stderr: redactOutput(result.stderr).trim(),
      }
      if (result.code !== 0) {
        report.status = 'FAIL'
        report.reason = 'interactive Tauri/browser driver exited unsuccessfully'
      } else {
        const driverReport = await readJson(driverReportPath)
        const validation = await validateDriverReport(driverReport, screenshotDirectory, required)
        report.screenshots = validation.ok ? validation.screenshots : await listScreenshots(screenshotDirectory)
        report.driver.report = driverReport === null ? null : {
          schemaVersion: driverReport.schemaVersion ?? null,
          status: driverReport.status ?? null,
          application: driverReport.application ?? null,
          browser: driverReport.browser ?? null,
          states: Array.isArray(driverReport.states) ? driverReport.states : [],
          assertions: Array.isArray(driverReport.assertions) ? driverReport.assertions : [],
          contextAuthorization: validation.ok ? validation.contextAuthorization : null,
          sessionEvidence: validation.ok ? validation.sessionEvidence : null,
        }
        report.status = validation.ok ? 'PASS' : 'FAIL'
        report.reason = validation.reason
      }
    }
  } finally {
    await writeReport(artifactRoot, report, 'r07-lens-e2e.json')
    if (isOwnedPath(runRoot, driverReportPath) && driverReportPath !== runRoot) {
      await removeOwnedPath(runRoot, driverReportPath).catch(() => undefined)
    }
    await removeOwnedPath(runRoot, runRoot).catch(() => undefined)
  }
  return report
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runLensE2E()
  console.log(JSON.stringify({
    report: report.artifacts.report,
    L3: report.status,
    exitCode: exitCodeForLensStatus(report.status),
  }))
  process.exitCode = exitCodeForLensStatus(report.status)
}
