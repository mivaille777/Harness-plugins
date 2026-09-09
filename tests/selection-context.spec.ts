import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  SelectionContextService,
  SelectionContextExpansionError,
  SelectionSnapshotCache,
  SelectionSnapshotValidationError,
  expandSelectionSnapshot,
  normalizeSelectionSnapshot,
  type SelectionSnapshot,
} from '../src/index.js'

function makeSnapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    id: 'selection-1',
    revision: 1,
    capturedAt: 1_000,
    selection: { text: 'Gaussian-process posterior uncertainty' },
    source: {
      kind: 'browser',
      app: 'Chrome',
      process: 'chrome.exe',
      windowTitle: 'Paper',
    },
    document: {
      title: 'Safe Bayesian Optimization',
      url: 'https://example.test/paper',
      section: '3.2 Acquisition Function',
    },
    context: {
      before: 'Previous paragraph.',
      after: 'Next paragraph.',
      sectionText: 'Section context.',
      pageText: 'Page context.',
      pageAvailable: true,
    },
    capabilities: {
      localContext: true,
      sectionContext: true,
      pageContext: true,
      screenshot: false,
    },
    geometry: {
      monitorId: 'display-1',
      x: 100,
      y: 200,
      width: 300,
      height: 40,
    },
    provider: 'browser-dom',
    confidence: 0.99,
    ...overrides,
  }
}

describe('SelectionSnapshot validation', () => {
  it('preserves Chinese, emoji, surrounding whitespace, and long selections', () => {
    const text = `  多模态 RAG 🚀 ${'x'.repeat(12_000)}  `
    const snapshot = normalizeSelectionSnapshot(makeSnapshot({ selection: { text } }))

    expect(snapshot.selection.text).toBe(text)
    expect(snapshot.selection.text.length).toBeGreaterThan(10_000)
  })

  it('rejects an empty or whitespace-only selection', () => {
    expect(() => normalizeSelectionSnapshot(makeSnapshot({ selection: { text: '   \n\t' } })))
      .toThrow(SelectionSnapshotValidationError)
  })

  it('rejects malformed external input with a domain validation error', () => {
    expect(() => normalizeSelectionSnapshot({
      id: 'bad-selection',
      revision: 1,
      capturedAt: Date.now(),
    })).toThrow(SelectionSnapshotValidationError)
  })

  it('rejects invalid confidence and geometry', () => {
    expect(() => normalizeSelectionSnapshot(makeSnapshot({ confidence: 1.1 })))
      .toThrow('confidence must be a finite number between 0 and 1')

    expect(() => normalizeSelectionSnapshot(makeSnapshot({
      geometry: { x: 0, y: 0, width: -1, height: 20 },
    }))).toThrow('geometry width and height must be non-negative')
  })

  it('returns a detached deeply frozen snapshot', () => {
    const input = makeSnapshot()
    const snapshot = normalizeSelectionSnapshot(input)

    expect(snapshot).not.toBe(input)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.selection)).toBe(true)
    expect(Object.isFrozen(snapshot.context)).toBe(true)

    expect(() => {
      ;(snapshot.selection as { text: string }).text = 'mutated'
    }).toThrow()
    expect(snapshot.selection.text).toBe('Gaussian-process posterior uncertainty')
  })
})

describe('SelectionSnapshotCache', () => {
  it('accepts only a strictly newer revision for the same snapshot id', () => {
    const cache = new SelectionSnapshotCache()

    expect(cache.update(makeSnapshot({ revision: 2 })).accepted).toBe(true)

    const stale = cache.update(makeSnapshot({ revision: 1, selection: { text: 'stale' } }))
    expect(stale.accepted).toBe(false)
    if (stale.accepted) throw new Error('expected stale revision to be rejected')
    expect(stale.reason).toBe('stale-revision')
    expect(cache.current()?.revision).toBe(2)

    const equal = cache.update(makeSnapshot({ revision: 2, selection: { text: 'duplicate' } }))
    expect(equal.accepted).toBe(false)
    expect(cache.current()?.selection.text).toBe('Gaussian-process posterior uncertainty')

    const newer = cache.update(makeSnapshot({ revision: 3, selection: { text: 'new revision' } }))
    expect(newer.accepted).toBe(true)
    expect(cache.current()?.selection.text).toBe('new revision')
  })

  it('keeps an old immutable snapshot when a new selection becomes current', () => {
    const cache = new SelectionSnapshotCache()
    const first = cache.update(makeSnapshot()).snapshot

    cache.update(makeSnapshot({
      id: 'selection-2',
      revision: 1,
      selection: { text: 'Second selection' },
    }))

    expect(cache.current()?.id).toBe('selection-2')
    expect(cache.get('selection-1')).toBe(first)
    expect(first.selection.text).toBe('Gaussian-process posterior uncertainty')
  })

  it('expires from ingestion time rather than capturedAt', () => {
    let now = 10_000
    const cache = new SelectionSnapshotCache({ ttlMs: 100, now: () => now })

    cache.update(makeSnapshot({ capturedAt: 1 }))
    now = 10_099
    expect(cache.current()).toBeDefined()

    now = 10_100
    expect(cache.current()).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('bounds memory by evicting the oldest cached snapshot', () => {
    const cache = new SelectionSnapshotCache({ maxSnapshots: 2 })

    cache.update(makeSnapshot({ id: 'selection-1' }))
    cache.update(makeSnapshot({ id: 'selection-2' }))
    cache.update(makeSnapshot({ id: 'selection-3' }))

    expect(cache.size).toBe(2)
    expect(cache.get('selection-1')).toBeUndefined()
    expect(cache.get('selection-2')).toBeDefined()
    expect(cache.current()?.id).toBe('selection-3')
  })
})

describe('SelectionContextService', () => {
  it('registers a usable ctx.selectionContext capability and exposes cache operations', () => {
    const ctx = new Context()
    const service = new SelectionContextService(ctx, { ttlMs: 1_000 })

    // Cordis may expose a tracked service proxy through ctx, so identity equality
    // with the constructor return value is not part of the service contract.
    expect(ctx.selectionContext).toBeDefined()
    expect(ctx.selectionContext.current()).toBeUndefined()

    expect(ctx.selectionContext.update(makeSnapshot()).accepted).toBe(true)
    expect(ctx.selectionContext.current()?.id).toBe('selection-1')
    expect(ctx.selectionContext.get('selection-1')?.provider).toBe('browser-dom')

    // The directly constructed service and ctx capability must observe the same state.
    expect(service.current()?.id).toBe('selection-1')

    ctx.selectionContext.clear('selection-1')
    expect(ctx.selectionContext.current()).toBeUndefined()
    expect(service.current()).toBeUndefined()
  })

  it('expands explicitly requested local context from the immutable revision', () => {
    const ctx = new Context()
    const service = new SelectionContextService(ctx)
    const snapshot = makeSnapshot({ revision: 7 })
    service.update(snapshot)

    expect(service.expand(snapshot.id, 'local')).toEqual({
      snapshotId: snapshot.id,
      revision: 7,
      scope: 'local',
      context: { before: 'Previous paragraph.', after: 'Next paragraph.' },
      completeness: 'complete',
      truncated: false,
    })
  })

  it('reports capability and captured-data failures separately', () => {
    const ctx = new Context()
    const service = new SelectionContextService(ctx)
    const unavailable = makeSnapshot({
      capabilities: { localContext: false, sectionContext: false, pageContext: false, screenshot: false },
      context: { pageAvailable: false },
    })
    service.update(unavailable)

    expect(() => service.expand(unavailable.id, 'local')).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    )
    expect(() => service.expand(unavailable.id, 'section')).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    )
    expect(() => service.expand(unavailable.id, 'page')).toThrowError(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    )

    const missingText = makeSnapshot({
      revision: 2,
      capabilities: { localContext: true, sectionContext: true, pageContext: true, screenshot: false },
      context: { pageAvailable: true },
    })
    service.update(missingText)
    expect(() => service.expand(missingText.id, 'section')).toThrowError(
      expect.objectContaining({ code: 'CONTEXT_UNAVAILABLE' }),
    )
    expect(() => service.expand('missing-snapshot', 'local')).toThrowError(
      expect.objectContaining({ code: 'SNAPSHOT_NOT_FOUND' }),
    )
    expect(() => service.expand(missingText.id, 'page')).toThrow(SelectionContextExpansionError)
  })

  it('returns page text only when the provider captured page scope', () => {
    const snapshot = normalizeSelectionSnapshot(makeSnapshot())
    expect(expandSelectionSnapshot(snapshot, 'page')).toMatchObject({
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      scope: 'page',
      context: { pageText: 'Page context.' },
      completeness: 'complete',
      truncated: false,
    })
  })

  it('bounds code points and aggregate UTF-8 bytes without splitting emoji', () => {
    const snapshot = normalizeSelectionSnapshot(makeSnapshot({
      context: {
        before: 'A🚀B',
        after: 'C😀D',
        pageAvailable: false,
      },
      capabilities: { localContext: true, sectionContext: false, pageContext: false, screenshot: false },
    }))

    const expansion = expandSelectionSnapshot(snapshot, 'local', { maxCodePoints: 2, maxBytes: 5 })
    expect(expansion.context.before).toBe('A🚀')
    expect(expansion.context.after).toBeUndefined()
    expect(expansion.completeness).toBe('partial')
    expect(expansion.truncated).toBe(true)
    expect(expansion.context.before?.endsWith('\ud83d')).toBe(false)
  })

  it('rejects invalid expansion limits before reading snapshot data', () => {
    const snapshot = normalizeSelectionSnapshot(makeSnapshot())
    expect(() => expandSelectionSnapshot(snapshot, 'local', { maxCodePoints: 0 })).toThrow('positive safe integer')
    expect(() => expandSelectionSnapshot(snapshot, 'local', { maxBytes: Number.MAX_SAFE_INTEGER + 1 })).toThrow('positive safe integer')
  })
})
