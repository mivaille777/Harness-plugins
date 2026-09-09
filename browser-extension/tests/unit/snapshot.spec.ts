import { describe, expect, it } from 'vitest'
import { buildBrowserSnapshot } from '../../src/snapshot'

const capture = {
  text: 'exploitation',
  language: 'en',
  before: 'balances exploration and',
  after: 'under uncertainty',
  sectionText: '3.2 Acquisition Function The acquisition function balances exploration and exploitation.',
  heading: '3.2 Acquisition Function',
  frameUrl: 'https://example.test/paper#section-3-2',
  title: 'Frame title',
  topLevel: true,
  capturedAt: 1234,
  geometry: { x: 100, y: 200, width: 80, height: 20 },
} as const

describe('buildBrowserSnapshot', () => {
  it('uses tab metadata for document identity and keeps frame metadata', () => {
    const snapshot = buildBrowserSnapshot(
      capture,
      { tabUrl: 'https://example.test/paper', tabTitle: 'Safe Bayesian Optimization' },
      () => 'unit-id',
    )

    expect(snapshot.id).toBe('browser-unit-id')
    expect(snapshot.selection.text).toBe('exploitation')
    expect(snapshot.source.kind).toBe('browser')
    expect(snapshot.document.url).toBe('https://example.test/paper')
    expect(snapshot.document.frameUrl).toBe('https://example.test/paper#section-3-2')
    expect(snapshot.document.section).toBe('3.2 Acquisition Function')
    expect(snapshot.context.before).toContain('exploration')
    expect(snapshot.capabilities).toEqual({
      localContext: true,
      sectionContext: true,
      pageContext: false,
      screenshot: false,
    })
    expect(snapshot.provider).toBe('browser-dom')
    expect(snapshot.confidence).toBe(0.98)
  })

  it('does not claim screen geometry confidence for framed selections', () => {
    const snapshot = buildBrowserSnapshot(
      { ...capture, topLevel: false, geometry: undefined },
      { tabUrl: 'https://example.test/paper' },
      () => 'frame-id',
    )

    expect(snapshot.geometry).toBeUndefined()
    expect(snapshot.confidence).toBe(0.94)
  })

  it('advertises page context only when the provider captured page text', () => {
    const snapshot = buildBrowserSnapshot(
      { ...capture, pageText: 'Full captured page text.' },
      { tabUrl: 'https://example.test/paper', tabTitle: 'Safe Bayesian Optimization' },
      () => 'page-id',
    )

    expect(snapshot.context.pageText).toBe('Full captured page text.')
    expect(snapshot.context.pageAvailable).toBe(true)
    expect(snapshot.capabilities.pageContext).toBe(true)
  })
})
