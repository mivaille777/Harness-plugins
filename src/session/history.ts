import { isAppendSurfaceEvent, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock, MessageSource } from '@deepseek-ai/dsh-llm'

/** One durable user- or assistant-authored text entry for the Lens history view. */
export interface SessionHistoryEntry {
  /** Durable event sequence, used as the stable entry identity. */
  readonly seq: number
  /** Durable event timestamp in Unix epoch milliseconds. */
  readonly time: number
  /** Conversation role shown in the history view. */
  readonly role: 'user' | 'assistant'
  /** Visible text blocks in their durable message order. */
  readonly text: string
  /** Producer kind recorded on the durable message when available. */
  readonly sourceKind?: string
  /** Selection Companion request identity, when the source recorded one. */
  readonly requestId?: string
}

/**
 * Project the complete human-visible transcript from a durable session log.
 *
 * The projection intentionally reads append-origin surface events rather than
 * the compacted model surface: replacements must not erase history the user
 * already saw. Stream chunks, tool results, reasoning, and non-text blocks do
 * not create a second assistant transcript or invented text representation.
 * @param events - Complete durable events in session sequence order.
 * @returns Detached user and assistant text entries in durable order.
 */
export function projectSessionHistory(events: readonly SessionEvent[]): readonly SessionHistoryEntry[] {
  const entries: SessionHistoryEntry[] = []
  for (const event of events) {
    if (!isAppendSurfaceEvent(event)) continue
    switch (event.type) {
      case 'user/message': {
        const text = visibleText(event.data.content)
        if (text !== '') entries.push({
          seq: event.seq,
          time: event.time,
          role: 'user',
          text,
          ...sourceDetails(event.data.source),
        })
        break
      }
      case 'assistant/message': {
        const text = visibleText(event.data.message.content)
        if (text !== '') entries.push({
          seq: event.seq,
          time: event.time,
          role: 'assistant',
          text,
          ...sourceDetails(event.data.message.source),
        })
        break
      }
      default:
        // tool/result is model context, but not a user- or assistant-authored history entry.
        break
    }
  }
  return entries
}

/**
 * Return the raw durable-log high-water mark after a history read.
 *
 * A non-visible event can follow the last history entry, so callers must use
 * this cursor rather than the last projected entry when they subscribe.
 * @param events - Complete durable events in session sequence order.
 * @returns The final durable event sequence, or `undefined` for an empty log.
 */
export function sessionHistoryCursor(events: readonly SessionEvent[]): number | undefined {
  return events.at(-1)?.seq
}

/** Extract text blocks without turning hidden or structured blocks into UI text. */
function visibleText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Read source metadata without requiring a Lens-specific message source in the Harness package. */
function sourceDetails(source: MessageSource): Pick<SessionHistoryEntry, 'sourceKind' | 'requestId'> {
  const candidate = source as MessageSource & { readonly requestId?: unknown }
  return {
    sourceKind: source.kind,
    ...(typeof candidate.requestId === 'string' ? { requestId: candidate.requestId } : {}),
  }
}
