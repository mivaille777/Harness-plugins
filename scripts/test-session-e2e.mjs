import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  EXIT_CODES,
  createRunDirectories,
  preflight,
  removeOwnedPath,
  runProfileTask,
  startLocalModelServer,
  writeReport,
} from './r07-runner.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const startedAt = new Date().toISOString()
const realRequested = process.env.R07_RUN_REAL === '1'
const runDirectories = await createRunDirectories()
const artifactRoot = process.env.R07_ARTIFACT_ROOT === undefined
  ? join(tmpdir(), 'dsh-selection-companion-r07-reports')
  : resolve(process.env.R07_ARTIFACT_ROOT)
const preflightResult = await preflight(process.env)
const report = {
  schemaVersion: 1,
  startedAt,
  repository: repoRoot,
  git: null,
  layers: {
    L1: { status: 'NOT RUN', reason: null },
    L2: { status: 'NOT RUN', reason: null },
  },
  preflight: preflightResult,
  artifacts: { report: join(artifactRoot, 'r07-session-e2e.json'), runRoot: runDirectories.root },
}

let modelServer
try {
  if (preflightResult.failures.length > 0) {
    report.layers.L1 = { status: 'NOT RUN', reason: preflightResult.failures.join('; ') }
    report.layers.L2 = { status: 'NOT RUN', reason: 'L1 prerequisites are missing' }
  } else {
    modelServer = await startLocalModelServer()
    report.layers.L1 = await runProfileTask({
      home: runDirectories.home,
      workspace: runDirectories.workspace,
      repoRoot,
      modelServer,
    })
    if (realRequested) {
      if (!preflightResult.apiKeyPresent) {
        report.layers.L2 = { status: 'NOT RUN', reason: 'R07_RUN_REAL=1 requires DEEPSEEK_API_KEY in the process environment' }
      } else {
        report.layers.L2 = await runProfileTask({
          home: runDirectories.home,
          workspace: runDirectories.workspace,
          repoRoot,
          modelServer,
          real: true,
        })
      }
    } else {
      report.layers.L2 = { status: 'NOT RUN', reason: 'set R07_RUN_REAL=1 to opt into a real model request' }
    }
    report.modelServer = {
      mode: 'local-deterministic-sse',
      requestCount: modelServer.requests.length,
      paths: [...new Set(modelServer.requests.map(request => request.url))],
    }
  }
} catch (error) {
  report.layers.L1 = { status: 'FAIL', reason: error instanceof Error ? error.message : String(error) }
} finally {
  await modelServer?.close().catch(() => undefined)
  await writeReport(artifactRoot, report)
  await removeOwnedPath(runDirectories.root, runDirectories.root).catch(() => undefined)
}

const l1Status = report.layers.L1.status
const l2Status = report.layers.L2.status
const exitCode = l1Status === 'FAIL' || (realRequested && l2Status === 'FAIL')
  ? EXIT_CODES.FAIL
  : l1Status === 'NOT RUN' || (realRequested && l2Status === 'NOT RUN')
    ? EXIT_CODES.NOT_RUN
    : EXIT_CODES.PASS
console.log(JSON.stringify({
  report: report.artifacts.report,
  L1: report.layers.L1.status,
  L2: report.layers.L2.status,
  exitCode,
}))
process.exitCode = exitCode
