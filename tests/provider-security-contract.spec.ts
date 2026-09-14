import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { SelectionSnapshot } from '../src/context/snapshot.js'
import {
  normalizeSelectionMaterial,
  resolveSelectionMaterialForCall,
  selectionMaterialFromSnapshot,
} from '../src/session/material.js'

function snapshot(id: string, text: string, revision = 1): SelectionSnapshot {
  return {
    id,
    revision,
    capturedAt: 1_700_000_000_000 + revision,
    selection: { text, language: 'en' },
    source: {
      kind: 'word',
      app: 'Microsoft Word',
      process: 'WINWORD.EXE',
      windowTitle: 'Private paper.docx - Word',
    },
    document: {
      title: 'Private paper.docx',
      url: 'https://example.test/reference',
      filePath: 'C:\\Users\\private-user\\Documents\\Private paper.docx',
      section: '3.2 Results',
      frameUrl: 'https://example.test/frame',
    },
    context: {
      before: 'provider-only before context',
      after: 'provider-only after context',
      sectionText: 'provider-only section context',
      pageText: 'provider-only page context',
      pageAvailable: true,
    },
    capabilities: {
      localContext: true,
      sectionContext: true,
      pageContext: true,
      screenshot: true,
    },
    geometry: {
      monitorId: 'monitor-private',
      x: 12,
      y: 34,
      width: 56,
      height: 78,
    },
    provider: 'word-com',
    confidence: 0.99,
  }
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent
}

describe('provider security contract', () => {
  it('projects a rich provider snapshot onto selection-only, model-safe material', () => {
    const richSnapshot = snapshot('snapshot-rich', 'Only this selected text is authorized.')

    const material = selectionMaterialFromSnapshot(richSnapshot)

    expect(material).toEqual({
      snapshotId: 'snapshot-rich',
      revision: 1,
      capturedAt: 1_700_000_000_001,
      selection: { text: 'Only this selected text is authorized.', language: 'en' },
      source: {
        kind: 'word',
        app: 'Microsoft Word',
        process: 'WINWORD.EXE',
        windowTitle: 'Private paper.docx - Word',
      },
      document: {
        title: 'Private paper.docx',
        url: 'https://example.test/reference',
        section: '3.2 Results',
        frameUrl: 'https://example.test/frame',
      },
      authorizedScope: 'selection',
      actualScope: 'selection',
      completeness: 'complete',
    })
    expect(material.document).not.toHaveProperty('filePath')
    expect(material).not.toHaveProperty('context')
    expect(material).not.toHaveProperty('capabilities')
    expect(material).not.toHaveProperty('geometry')
    expect(material).not.toHaveProperty('provider')
    expect(material).not.toHaveProperty('confidence')
  })

  it('strips a legacy or Rust-wire document filePath before durable material is exposed', () => {
    const normalized = normalizeSelectionMaterial({
      snapshotId: 'snapshot-legacy',
      revision: 4,
      capturedAt: 1_700_000_000_004,
      selection: { text: 'Legacy selection.' },
      source: { kind: 'pdf', app: 'Microsoft Edge' },
      document: {
        title: 'local.pdf',
        filePath: 'D:\\Research\\secret\\local.pdf',
        section: 'Page 4',
      },
      authorizedScope: 'selection',
      actualScope: 'selection',
      completeness: 'complete',
    })

    expect(normalized.document).toEqual({ title: 'local.pdf', section: 'Page 4' })
    expect(normalized.document).not.toHaveProperty('filePath')
  })

  it('binds a tool call to the durable material visible before that call, not a newer selection', () => {
    const first = selectionMaterialFromSnapshot(snapshot('snapshot-a', 'BOUND_SELECTION_A', 1))
    const newer = selectionMaterialFromSnapshot(snapshot('snapshot-b', 'NEWER_GLOBAL_SELECTION_B', 2))
    const callId = 'call-bound-to-a'
    const events: SessionEvent[] = [
      event(1, 'turn/start', { turn: 8 }),
      event(2, 'user/message', {
        id: 'message-a',
        role: 'user',
        content: [{ type: 'text', text: 'Explain the selected material.' }],
        source: { kind: 'selection-companion', requestId: 'request-a', material: first },
      }),
      event(3, 'tool/call', {
        turn: 8,
        step: 1,
        callId,
        name: 'selection_read_context',
        arguments: '{"scope":"selection"}',
      }),
      event(4, 'user/message', {
        id: 'message-b',
        role: 'user',
        content: [{ type: 'text', text: 'A later selection arrived.' }],
        source: { kind: 'selection-companion', requestId: 'request-b', material: newer },
      }),
    ]

    const bound = resolveSelectionMaterialForCall(events, callId)

    expect(bound.requestId).toBe('request-a')
    expect(bound.material.snapshotId).toBe('snapshot-a')
    expect(bound.material.selection.text).toBe('BOUND_SELECTION_A')
    expect(bound.material.selection.text).not.toBe('NEWER_GLOBAL_SELECTION_B')
  })
})
