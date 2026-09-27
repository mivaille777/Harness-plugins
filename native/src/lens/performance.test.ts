import { describe, expect, it } from 'vitest'
import {
  emptyLensPerformanceState,
  LENS_LATENCY_SAMPLE_WINDOW,
  recordLensLatency,
} from './performance'

describe('Lens performance metrics', () => {
  it('calculates nearest-rank percentiles independently for each latency path', () => {
    let state = emptyLensPerformanceState()
    for (const duration of [40, 10, 30, 20]) {
      state = recordLensLatency(state, 'passiveEntryVisible', duration)
    }
    state = recordLensLatency(state, 'lensInteractive', 8)

    expect(state.passiveEntryVisible).toMatchObject({ sampleCount: 4, p50Ms: 20, p95Ms: 40 })
    expect(state.lensInteractive).toMatchObject({ sampleCount: 1, p50Ms: 8, p95Ms: 8 })
  })

  it('keeps only the latest bounded latency samples', () => {
    let state = emptyLensPerformanceState()
    for (let duration = 0; duration <= LENS_LATENCY_SAMPLE_WINDOW; duration += 1) {
      state = recordLensLatency(state, 'lensInteractive', duration)
    }

    expect(state.lensInteractive.samplesMs).toHaveLength(LENS_LATENCY_SAMPLE_WINDOW)
    expect(state.lensInteractive.samplesMs[0]).toBe(1)
    expect(state.lensInteractive).toMatchObject({ sampleCount: 256, p50Ms: 128, p95Ms: 244 })
  })

  it('ignores invalid durations', () => {
    const state = emptyLensPerformanceState()

    expect(recordLensLatency(state, 'lensInteractive', -1)).toBe(state)
    expect(recordLensLatency(state, 'lensInteractive', Number.NaN)).toBe(state)
  })
})
