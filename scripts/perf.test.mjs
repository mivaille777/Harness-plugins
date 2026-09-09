import test from 'node:test'
import assert from 'node:assert/strict'
import { percentile, summarizeSamples, validatePerformanceReport } from './perf.mjs'

test('performance summary reports nearest-rank P50 and P95', () => {
  assert.equal(percentile([3, 1, 2, 4], 0.5), 2)
  assert.deepEqual(summarizeSamples([3, 1, 2, 4]), {
    sampleCount: 4,
    p50Ms: 2,
    p95Ms: 4,
    minMs: 1,
    maxMs: 4,
    meanMs: 2.5,
  })
})

test('performance validation rejects a report that hides unmeasured lanes', () => {
  const issues = validatePerformanceReport({
    schemaVersion: 1,
    status: 'MEASURED_LOCAL_ONLY',
    candidateSha: '0'.repeat(40),
    operations: { localContextExpansion: { sampleCount: 1, p95Ms: 1 } },
    unmeasuredOperations: [],
  })
  assert.match(issues.join('; '), /unmeasuredOperations/)
})
