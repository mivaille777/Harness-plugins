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
const DEFAULT_REQUIRED_STATES = Object.freeze(['idle', 'material', 'streaming', 'history'])
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

/** Normalize the required visual states while retaining the fixed minimum. */
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

/** Check the strict report written by a real Tauri/browser driver. */
export async function validateDriverReport(report, screenshotDirectory, required) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return { ok: false, reason: 'driver report is not an object', screenshots: [], states: [] }
  }
  if (report.schemaVersion !== 1) {
    return { ok: false, reason: 'driver report schemaVersion must be 1', screenshots: [], states: [] }
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
  if (!Array.isArray(report.assertions) || report.assertions.length === 0 || report.assertions.some(item => typeof item !== 'string')) {
    return { ok: false, reason: 'driver report needs named assertions', screenshots: [], states: [] }
  }
  if (!Array.isArray(report.states) || report.states.some(item => typeof item !== 'string')) {
    return { ok: false, reason: 'driver report needs a states array', screenshots: [], states: [] }
  }
  const states = [...new Set(report.states)]
  const missing = required.filter(state => !states.includes(state))
  if (missing.length > 0) {
    return { ok: false, reason: `driver report is missing required states: ${missing.join(', ')}`, screenshots: [], states }
  }
  if (!Array.isArray(report.screenshots) || report.screenshots.length === 0) {
    return { ok: false, reason: 'driver report needs screenshot paths', screenshots: [], states }
  }
  const screenshots = []
  for (const item of report.screenshots) {
    const relativePath = typeof item === 'string' ? item : item?.path
    const path = resolveScreenshotPath(screenshotDirectory, relativePath)
    if (path === null || extname(path).toLowerCase() !== '.png') {
      return { ok: false, reason: 'driver screenshot paths must be owned PNG files', screenshots: [], states }
    }
    let info
    try { info = await stat(path) } catch { info = null }
    if (info === null || !info.isFile() || info.size === 0) {
      return { ok: false, reason: `driver screenshot is missing or empty: ${relativePath}`, screenshots: [], states }
    }
    screenshots.push({ path, bytes: info.size, modifiedAt: info.mtime.toISOString() })
  }
  return { ok: true, reason: 'driver report, Tauri/browser identity, required states, and screenshots verified', screenshots, states }
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
          status: driverReport.status ?? null,
          application: driverReport.application ?? null,
          browser: driverReport.browser ?? null,
          states: Array.isArray(driverReport.states) ? driverReport.states : [],
          assertions: Array.isArray(driverReport.assertions) ? driverReport.assertions : [],
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
