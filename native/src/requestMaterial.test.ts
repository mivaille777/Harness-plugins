import { describe, expect, it } from 'vitest'
import type { SelectionMaterial } from '../../src/session/material.js'
import {
  buildAuthorizedMaterialPrompt,
  renderAuthorizedMaterialReference,
} from './requestMaterial'

const base: SelectionMaterial = {
  snapshotId: 'snapshot-ec04',
  revision: 4,
  capturedAt: 1_700_000_000_000,
  selection: { text: 'FIXED_SELECTION_SENTINEL', language: 'en' },
  source: { kind: 'browser', app: 'Chrome', windowTitle: 'EC04 fixture' },
  document: { title: 'EC04 fixture', url: 'https://example.test/ec04' },
  authorizedScope: 'selection',
  actualScope: 'selection',
  completeness: 'complete',
}

describe('EC-04 canonical material model input', () => {
  it('renders selection-only material without captured-but-unauthorized context', () => {
    const reference = renderAuthorizedMaterialReference(base)
    expect(reference).toContain('FIXED_SELECTION_SENTINEL')
    expect(reference).toContain('Authorized scope: selection')
    expect(reference).not.toContain('LOCAL_BEFORE_SENTINEL')
    expect(reference).not.toContain('PAGE_SENTINEL')
  })

  it.each([
    {
      scope: 'local' as const,
      context: { before: 'LOCAL_BEFORE_SENTINEL', after: 'LOCAL_AFTER_SENTINEL' },
      expected: ['LOCAL_BEFORE_SENTINEL', 'LOCAL_AFTER_SENTINEL'],
      excluded: ['SECTION_SENTINEL', 'PAGE_SENTINEL'],
    },
    {
      scope: 'section' as const,
      context: { sectionText: 'SECTION_SENTINEL' },
      expected: ['SECTION_SENTINEL'],
      excluded: ['LOCAL_BEFORE_SENTINEL', 'PAGE_SENTINEL'],
    },
    {
      scope: 'page' as const,
      context: { pageText: 'PAGE_SENTINEL' },
      expected: ['PAGE_SENTINEL'],
      excluded: ['LOCAL_BEFORE_SENTINEL', 'SECTION_SENTINEL'],
    },
  ])('renders only canonical $scope context', ({ scope, context, expected, excluded }) => {
    const material: SelectionMaterial = {
      ...base,
      authorizedScope: scope,
      actualScope: scope,
      completeness: 'partial',
      truncated: true,
      context,
    }
    const reference = renderAuthorizedMaterialReference(material)
    for (const value of expected) expect(reference).toContain(value)
    for (const value of excluded) expect(reference).not.toContain(value)
    expect(reference).toContain(`Authorized scope: ${scope}`)
    expect(reference).toContain('Completeness: partial')
    expect(reference).toContain('Truncated: yes')
  })

  it('builds the model prompt from exactly the rendered reference plus the user request', () => {
    const material: SelectionMaterial = {
      ...base,
      authorizedScope: 'local',
      actualScope: 'local',
      completeness: 'complete',
      truncated: false,
      context: { before: 'BEFORE', after: 'AFTER' },
    }
    const reference = renderAuthorizedMaterialReference(material)
    const prompt = buildAuthorizedMaterialPrompt(material, '  Explain why this matters.  ')
    expect(prompt).toBe(`${reference}\n\nUser request:\nExplain why this matters.`)
  })

  it('rejects a blank user request', () => {
    expect(() => buildAuthorizedMaterialPrompt(base, '   ')).toThrow('must not be blank')
  })
})
