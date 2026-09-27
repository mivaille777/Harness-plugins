export const LENS_LATENCY_SAMPLE_WINDOW = 256

export type LensLatencyMetric = 'passiveEntryVisible' | 'lensInteractive'

export interface RollingLatencySeries {
  readonly samplesMs: readonly number[]
  readonly sampleCount: number
  readonly p50Ms: number | null
  readonly p95Ms: number | null
}

export interface LensPerformanceState {
  readonly passiveEntryVisible: RollingLatencySeries
  readonly lensInteractive: RollingLatencySeries
}

const emptySeries = (): RollingLatencySeries => ({
  samplesMs: [],
  sampleCount: 0,
  p50Ms: null,
  p95Ms: null,
})

export const emptyLensPerformanceState = (): LensPerformanceState => ({
  passiveEntryVisible: emptySeries(),
  lensInteractive: emptySeries(),
})

function nearestRankPercentile(sortedSamples: readonly number[], percentile: number): number | null {
  if (sortedSamples.length === 0) return null
  const index = Math.ceil(sortedSamples.length * percentile / 100) - 1
  return sortedSamples[index] ?? null
}

export function recordLensLatency(
  state: LensPerformanceState,
  metric: LensLatencyMetric,
  durationMs: number,
): LensPerformanceState {
  if (!Number.isFinite(durationMs) || durationMs < 0) return state

  const samplesMs = [...state[metric].samplesMs, durationMs].slice(-LENS_LATENCY_SAMPLE_WINDOW)
  const sortedSamples = [...samplesMs].sort((left, right) => left - right)
  return {
    ...state,
    [metric]: {
      samplesMs,
      sampleCount: samplesMs.length,
      p50Ms: nearestRankPercentile(sortedSamples, 50),
      p95Ms: nearestRankPercentile(sortedSamples, 95),
    },
  }
}
