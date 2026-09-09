import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { expandSelectionSnapshot } from '../lib/context/expansion.js'

export const PERFORMANCE_SCHEMA_VERSION = 1
export const PERFORMANCE_OPERATIONS = ['localContextExpansion']
export const UNMEASURED_PERFORMANCE_OPERATIONS = [
  'lensOpen',
  'buttonFeedback',
  'hostAccept',
  'firstModelOutput',
  'completion',
  'disconnectRecovery',
  'cpu',
  'rss',
]

/** Parse a positive integer supplied by a performance command line option. */
export function parsePositiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return parsed
}

/** Return a nearest-rank percentile for a non-empty sample list. */
export function percentile(samples, fraction) {
  if (samples.length === 0) throw new RangeError('percentile requires at least one sample')
  if (!(fraction >= 0 && fraction <= 1)) throw new RangeError('percentile fraction must be between 0 and 1')
  const sorted = [...samples].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return sorted[index]
}

/** Summarize one measured duration series without applying a product threshold. */
export function summarizeSamples(samples) {
  if (samples.length === 0) throw new RangeError('a measured operation needs at least one sample')
  const total = samples.reduce((sum, sample) => sum + sample, 0)
  return {
    sampleCount: samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    meanMs: total / samples.length,
  }
}

/** Validate that a local performance report contains measured and unmeasured lanes. */
export function validatePerformanceReport(report) {
  const issues = []
  if (report?.schemaVersion !== PERFORMANCE_SCHEMA_VERSION) issues.push('unsupported performance report schema')
  if (report?.status !== 'MEASURED_LOCAL_ONLY') issues.push('performance report must be marked MEASURED_LOCAL_ONLY')
  if (typeof report?.candidateSha !== 'string' || !/^[0-9a-f]{40}$/.test(report.candidateSha)) issues.push('candidateSha must be a 40-character git SHA')
  if (!Array.isArray(report?.unmeasuredOperations) || report.unmeasuredOperations.length === 0) issues.push('unmeasuredOperations must be non-empty')
  for (const operation of PERFORMANCE_OPERATIONS) {
    const summary = report?.operations?.[operation]
    if (summary === undefined || summary.sampleCount < 1 || !Number.isFinite(summary.p95Ms)) issues.push(`${operation} has no valid samples`)
  }
  return issues
}

/** Run the deterministic local expansion workload used for repeatable performance evidence. */
export function runLocalExpansionBenchmark({ iterations = 20, innerLoops = 100, candidateSha = readCandidateSha() } = {}) {
  const sample = {
    id: 'perf-selection',
    revision: 1,
    capturedAt: 1,
    selection: { text: 'A fixed non-sensitive selection for a local benchmark.' },
    source: { kind: 'browser', app: 'performance-fixture' },
    context: {
      before: 'A bounded nearby context before the selection.',
      after: 'A bounded nearby context after the selection.',
      pageAvailable: false,
    },
    capabilities: { localContext: true, sectionContext: false, pageContext: false, screenshot: false },
    provider: 'performance-fixture',
    confidence: 1,
  }
  const samples = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now()
    for (let loop = 0; loop < innerLoops; loop += 1) expandSelectionSnapshot(sample, 'local')
    samples.push(performance.now() - startedAt)
  }
  const report = {
    schemaVersion: PERFORMANCE_SCHEMA_VERSION,
    status: 'MEASURED_LOCAL_ONLY',
    candidateSha,
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      iterations,
      innerLoops,
    },
    operations: { localContextExpansion: summarizeSamples(samples) },
    unmeasuredOperations: [...UNMEASURED_PERFORMANCE_OPERATIONS],
    limitations: [
      'This report measures the local context projection only.',
      'It does not measure a Tauri window, a real browser provider, a Harness host, a model, CPU trend, or RSS trend.',
      'The values are descriptive engineering evidence and do not establish a human-factors effect.',
    ],
  }
  const issues = validatePerformanceReport(report)
  if (issues.length > 0) throw new Error(issues.join('; '))
  return report
}

function readCandidateSha() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return '0000000000000000000000000000000000000000'
  }
}
