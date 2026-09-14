import { describe, expect, it } from 'vitest'
import type { SelectionSnapshot } from '../../src/context/snapshot.js'
import {
  authorizeExpandedContext,
  defaultAuthorizedMaterial,
  isAuthorizationCurrent,
} from './contextAuthorization'

const snapshot: SelectionSnapshot = {
  id: 'snapshot-ec03',
  revision: 3,
  capturedAt: 1_700_000_000_000,
  selection: { text: 'Fixed selected text', language: 'en' },
  source: { kind: 'browser', app: 'Chrome', windowTitle: 'EC03 fixture' },
  document: { title: 'EC03 fixture', url: 'https://example.test/ec03', filePath: 'C:/private/ec03.html' },
  context: {
    before: 'captured before',
    after: 'captured after',
    sectionText: 'captured section',
    pageText: 'captured page',
    pageAvailable: true,
  },
  capabilities: {
    localContext: true,
    sectionContext: true,
    pageContext: true,
    screenshot: false,
  },
  provider: 'fixture',
  confidence: 1,
}

describe('EC-03 explicit context authorization', () => {
  it('defaults to immutable selection-only material', () => {
    const material = defaultAuthorizedMaterial(snapshot)
    expect(material).toMatchObject({
      snapshotId: 'snapshot-ec03',
      revision: 3,
      authorizedScope: 'selection',
      actualScope: 'selection',
      completeness: 'complete',
    })
    expect(material).not.toHaveProperty('context')
    expect(material.document).not.toHaveProperty('filePath')
    expect(Object.isFrozen(material)).toBe(true)
  })

  it.each([
    ['local', { before: 'preview before', after: 'preview after' }, { before: 'preview before', after: 'preview after' }],
    ['section', { sectionText: 'preview section' }, { sectionText: 'preview section' }],
    ['page', { pageText: 'preview page' }, { pageText: 'preview page' }],
  ] as const)('freezes explicitly authorized %s context from the matching preview', (scope, context, expected) => {
    const material = authorizeExpandedContext(snapshot, {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      scope,
      completeness: 'partial',
      truncated: true,
      context,
    })

    expect(material).toMatchObject({
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      authorizedScope: scope,
      actualScope: scope,
      completeness: 'partial',
      truncated: true,
      context: expected,
    })
    expect(Object.isFrozen(material)).toBe(true)
  })

  it('copies only fields permitted by the authorized scope', () => {
    const material = authorizeExpandedContext(snapshot, {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      scope: 'local',
      completeness: 'complete',
      truncated: false,
      context: {
        before: 'allowed before',
        after: 'allowed after',
        sectionText: 'must not cross the local authorization boundary',
        pageText: 'must not cross the local authorization boundary',
      },
    })

    expect(material.context).toEqual({ before: 'allowed before', after: 'allowed after' })
  })

  it('rejects stale preview identity instead of silently authorizing it', () => {
    expect(() => authorizeExpandedContext(snapshot, {
      snapshotId: 'snapshot-other',
      revision: snapshot.revision,
      scope: 'local',
      completeness: 'complete',
      truncated: false,
      context: { before: 'stale' },
    })).toThrow('no longer matches')

    expect(() => authorizeExpandedContext(snapshot, {
      snapshotId: snapshot.id,
      revision: snapshot.revision + 1,
      scope: 'page',
      completeness: 'complete',
      truncated: false,
      context: { pageText: 'newer revision' },
    })).toThrow('no longer matches')
  })

  it('marks authorization stale as soon as snapshot identity changes', () => {
    const material = authorizeExpandedContext(snapshot, {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      scope: 'section',
      completeness: 'complete',
      truncated: false,
      context: { sectionText: 'authorized section' },
    })
    expect(isAuthorizationCurrent(material, snapshot)).toBe(true)
    expect(isAuthorizationCurrent(material, { ...snapshot, revision: snapshot.revision + 1 })).toBe(false)
    expect(isAuthorizationCurrent(material, { ...snapshot, id: 'snapshot-new' })).toBe(false)
  })
})
