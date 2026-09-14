import { describe, expect, it } from 'vitest'
import { normalizeSelectionMaterial } from '../src/session/material.js'

const base = {
  snapshotId: 'snapshot-ec02',
  revision: 8,
  capturedAt: 1_700_000_000_000,
  selection: { text: 'Fixed selection.' },
  source: { kind: 'browser' as const, app: 'Chrome' },
  document: { title: 'EC02 fixture', url: 'https://example.test/ec02', filePath: 'C:/private/local.html' },
}

describe('EC-02 canonical authorized material', () => {
  it.each([
    {
      name: 'selection',
      material: {
        ...base,
        authorizedScope: 'selection',
        actualScope: 'selection',
        completeness: 'complete',
      },
    },
    {
      name: 'local',
      material: {
        ...base,
        authorizedScope: 'local',
        actualScope: 'local',
        completeness: 'partial',
        truncated: true,
        context: { before: 'before', after: 'after' },
      },
    },
    {
      name: 'section',
      material: {
        ...base,
        authorizedScope: 'section',
        actualScope: 'section',
        completeness: 'complete',
        truncated: false,
        context: { sectionText: 'section body' },
      },
    },
    {
      name: 'page',
      material: {
        ...base,
        authorizedScope: 'page',
        actualScope: 'page',
        completeness: 'partial',
        truncated: true,
        context: { pageText: 'page body' },
      },
    },
  ])('accepts canonical $name material and strips local file paths', ({ material }) => {
    const normalized = normalizeSelectionMaterial(material)
    expect(normalized.document).not.toHaveProperty('filePath')
    expect(Object.isFrozen(normalized)).toBe(true)
  })

  it('allows actual scope to be narrower than the explicit authorization', () => {
    expect(normalizeSelectionMaterial({
      ...base,
      authorizedScope: 'page',
      actualScope: 'section',
      completeness: 'partial',
      truncated: true,
      context: { sectionText: 'bounded section fallback' },
    })).toMatchObject({ authorizedScope: 'page', actualScope: 'section' })
  })

  it.each([
    {
      name: 'actual scope exceeds authorization',
      material: {
        ...base,
        authorizedScope: 'local',
        actualScope: 'page',
        completeness: 'complete',
        context: { pageText: 'must not pass' },
      },
    },
    {
      name: 'selection smuggles page context',
      material: {
        ...base,
        authorizedScope: 'selection',
        actualScope: 'selection',
        completeness: 'complete',
        context: { pageText: 'must not pass' },
      },
    },
    {
      name: 'local smuggles section context',
      material: {
        ...base,
        authorizedScope: 'local',
        actualScope: 'local',
        completeness: 'complete',
        context: { before: 'ok', sectionText: 'must not pass' },
      },
    },
    {
      name: 'section has no section text',
      material: {
        ...base,
        authorizedScope: 'section',
        actualScope: 'section',
        completeness: 'partial',
        context: {},
      },
    },
    {
      name: 'page has no page text',
      material: {
        ...base,
        authorizedScope: 'page',
        actualScope: 'page',
        completeness: 'partial',
        context: { before: 'wrong field' },
      },
    },
    {
      name: 'selection reports truncation',
      material: {
        ...base,
        authorizedScope: 'selection',
        actualScope: 'selection',
        completeness: 'complete',
        truncated: true,
      },
    },
  ])('rejects $name', ({ material }) => {
    expect(() => normalizeSelectionMaterial(material)).toThrow()
  })
})
