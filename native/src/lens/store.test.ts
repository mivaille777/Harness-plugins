import { describe, expect, it } from 'vitest'
import {
  initialLensState,
  sameLensSelection,
  transitionLens,
  type LensBinding,
  type LensEvent,
  type LensState,
} from './store'

const first: LensBinding = { snapshotId: 'snapshot-a', revision: 3, openedAt: 100 }
const second: LensBinding = { snapshotId: 'snapshot-b', revision: 1, openedAt: 200 }

function send(state: LensState, ...events: LensEvent[]): LensState {
  return events.reduce(transitionLens, state)
}

describe('Lens state model', () => {
  it('moves from Hidden to PassiveEntry when a new selection arrives', () => {
    const state = transitionLens(initialLensState, { type: 'selection_detected', binding: first })

    expect(state.view).toBe('passive-entry')
    expect(state.latestSelection).toEqual(first)
    expect(state.binding).toBeNull()
  })

  it('pins the latest snapshot and revision when the entry opens', () => {
    const state = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
    )

    expect(state.view).toBe('lens-open')
    expect(state.binding).toEqual(first)
  })

  it('keeps an open Lens bound when a newer selection arrives', () => {
    const state = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
      { type: 'selection_detected', binding: second },
    )

    expect(state.view).toBe('lens-open')
    expect(state.binding).toEqual(first)
    expect(state.latestSelection).toEqual(second)
  })

  it('switches the binding only after an explicit use-latest event', () => {
    const state = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
      { type: 'selection_detected', binding: second },
      { type: 'use_latest_selection' },
    )

    expect(state.binding).toEqual(second)
    expect(state.latestSelection).toEqual(second)
  })

  it('does not allow a binding switch while a request is active', () => {
    const state = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
      { type: 'action_submit', action: 'ask', requestId: 'request-1' },
      { type: 'stream_start', requestId: 'request-1' },
      { type: 'selection_detected', binding: second },
      { type: 'use_latest_selection' },
    )

    expect(state.binding).toEqual(first)
    expect(state.latestSelection).toEqual(second)
  })

  it('hides on Escape without cancelling a streaming request', () => {
    const state = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
      { type: 'action_submit', action: 'explain', requestId: 'request-1' },
      { type: 'stream_start', requestId: 'request-1' },
      { type: 'lens_close' },
    )

    expect(state.view).toBe('hidden')
    expect(state.binding).toEqual(first)
    expect(state.request).toMatchObject({ phase: 'streaming', requestId: 'request-1' })
    const reopened = send(state,
      { type: 'selection_detected', binding: second },
      { type: 'lens_open' },
    )
    expect(reopened.binding).toEqual(first)
    expect(reopened.latestSelection).toEqual(second)
  })

  it('invalidates only the matching source binding', () => {
    const opened = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
    )
    const afterStaleInvalidation = transitionLens(opened, { type: 'source_invalidated', binding: second })
    const invalidated = transitionLens(opened, { type: 'source_invalidated', binding: first })

    expect(afterStaleInvalidation).toBe(opened)
    expect(invalidated.view).toBe('hidden')
    expect(invalidated.binding).toBeNull()
  })

  it('does not reopen a passive entry for a duplicate selection identity', () => {
    const opened = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
      { type: 'lens_close' },
    )
    const duplicate = transitionLens(opened, {
      type: 'selection_detected',
      binding: { ...first, openedAt: 999 },
    })

    expect(duplicate).toBe(opened)
    expect(duplicate.view).toBe('hidden')
  })

  it('correlates stream events with the active request and stores no response text', () => {
    const submitted = send(initialLensState,
      { type: 'selection_detected', binding: first },
      { type: 'entry_open' },
      { type: 'action_submit', action: 'ask', requestId: 'logical-request' },
      { type: 'request_accepted', submittedRequestId: 'logical-request', requestId: 'request-1' },
    )
    const stale = transitionLens(submitted, { type: 'stream_start', requestId: 'logical-request' })
    const streaming = send(submitted,
      { type: 'stream_start', requestId: 'request-1' },
      { type: 'stream_delta', requestId: 'request-1', delta: '你好' },
      { type: 'stream_end', requestId: 'request-1' },
    )

    expect(stale).toBe(submitted)
    expect(streaming.request).toMatchObject({
      phase: 'completed',
      requestId: 'request-1',
      receivedDeltas: 1,
      receivedCharacters: 2,
    })
    expect(streaming.request).not.toHaveProperty('answer')
    expect(transitionLens(streaming, { type: 'action_error', requestId: 'request-1' })).toBe(streaming)
  })

  it('ignores selections while capture is paused and after shutdown', () => {
    const paused = send(initialLensState,
      { type: 'capture_paused' },
      { type: 'selection_detected', binding: first },
    )
    const stopped = send(initialLensState,
      { type: 'shutdown' },
      { type: 'selection_detected', binding: first },
    )

    expect(paused.latestSelection).toBeNull()
    expect(stopped.latestSelection).toBeNull()
  })

  it('defines snapshot identity by id and revision, not presentation time', () => {
    expect(sameLensSelection(first, { ...first, openedAt: 999 })).toBe(true)
    expect(sameLensSelection(first, { ...first, revision: 4 })).toBe(false)
  })
})
