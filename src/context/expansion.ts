import type { ContextScope } from '../bridge/protocol.js'
import type { SelectionSnapshot } from './snapshot.js'

/** Context scopes that can add material around a fixed selection. */
export const EXPANDABLE_CONTEXT_SCOPES = ['local', 'section', 'page'] as const

/** A scope that may be requested after the user has fixed a selection. */
export type ExpandableContextScope = (typeof EXPANDABLE_CONTEXT_SCOPES)[number]

/** Deployment limits for one context expansion response. */
export interface SelectionContextExpansionOptions {
  /** Maximum Unicode code points retained in each returned context field. */
  readonly maxCodePoints?: number
  /** Maximum UTF-8 bytes retained across all returned context fields. */
  readonly maxBytes?: number
}

/** Security defaults that keep one expansion well below the IPC frame limit. */
export const DEFAULT_CONTEXT_EXPANSION_MAX_CODE_POINTS = 6_000
export const DEFAULT_CONTEXT_EXPANSION_MAX_BYTES = 24_000

/** Stable failures produced before an expansion can leave the Host. */
export type SelectionContextExpansionErrorCode =
  | 'SNAPSHOT_NOT_FOUND'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONTEXT_UNAVAILABLE'

/** A user-readable, non-sensitive expansion failure. */
export class SelectionContextExpansionError extends Error {
  constructor(
    message: string,
    readonly code: SelectionContextExpansionErrorCode,
  ) {
    super(message)
    this.name = 'SelectionContextExpansionError'
  }
}

/** Context fields returned by the expansion endpoint. */
export interface ExpandedSelectionContext {
  readonly before?: string
  readonly after?: string
  readonly sectionText?: string
  readonly pageText?: string
}

/** A bounded, capability-checked projection of one immutable selection. */
export interface SelectionContextExpansion {
  readonly snapshotId: string
  readonly revision: number
  readonly scope: ContextScope
  readonly context: ExpandedSelectionContext
  readonly completeness: 'complete' | 'partial'
  /** True when at least one field was shortened by a configured bound. */
  readonly truncated: boolean
}

/**
 * Project context already captured with a selection into an explicitly requested scope.
 * No page is fetched here: a provider must put page text in the immutable snapshot before
 * the request can expose it. This keeps the response tied to the displayed revision.
 *
 * @param snapshot - immutable selection snapshot to project.
 * @param scope - requested context scope.
 * @param options - byte and code-point bounds for returned fields.
 * @returns a bounded context projection.
 * @throws {SelectionContextExpansionError} when the snapshot lacks the requested capability/data.
 */
export function expandSelectionSnapshot(
  snapshot: SelectionSnapshot,
  scope: ContextScope,
  options: SelectionContextExpansionOptions = {},
): SelectionContextExpansion {
  const maxCodePoints = options.maxCodePoints ?? DEFAULT_CONTEXT_EXPANSION_MAX_CODE_POINTS
  const maxBytes = options.maxBytes ?? DEFAULT_CONTEXT_EXPANSION_MAX_BYTES
  validateLimit(maxCodePoints, 'maxCodePoints')
  validateLimit(maxBytes, 'maxBytes')

  if (scope === 'selection') {
    return {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      scope,
      context: {},
      completeness: 'complete',
      truncated: false,
    }
  }

  if (scope === 'local' && !snapshot.capabilities.localContext) {
    throw capabilityUnavailable('local context is not available for this selection')
  }
  if (scope === 'section' && !snapshot.capabilities.sectionContext) {
    throw capabilityUnavailable('section context is not available for this selection')
  }
  if (scope === 'page' && (!snapshot.capabilities.pageContext || !snapshot.context.pageAvailable)) {
    throw capabilityUnavailable('page context is not available for this selection')
  }

  const source = scope === 'local'
    ? { before: snapshot.context.before, after: snapshot.context.after }
    : scope === 'section'
      ? { sectionText: snapshot.context.sectionText }
      : { pageText: snapshot.context.pageText }
  const present = Object.values(source).some(value => typeof value === 'string' && value.length > 0)
  if (!present) throw contextUnavailable(`${scope} context has no captured text`)

  let remainingBytes = maxBytes
  let truncated = false
  const context: { -readonly [K in keyof ExpandedSelectionContext]?: string } = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string' || value.length === 0) continue
    const bounded = truncateContext(value, maxCodePoints, remainingBytes)
    if (bounded.text.length > 0) {
      context[key as keyof ExpandedSelectionContext] = bounded.text
      remainingBytes -= bounded.bytes
    }
    truncated ||= bounded.truncated
  }

  const expectedFields = scope === 'local' ? 2 : 1
  const complete = !truncated && Object.keys(context).length === expectedFields
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    scope,
    context,
    completeness: complete ? 'complete' : 'partial',
    truncated,
  }
}

function capabilityUnavailable(message: string): SelectionContextExpansionError {
  return new SelectionContextExpansionError(message, 'CAPABILITY_UNAVAILABLE')
}

function contextUnavailable(message: string): SelectionContextExpansionError {
  return new SelectionContextExpansionError(message, 'CONTEXT_UNAVAILABLE')
}

function validateLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
}

function truncateContext(
  input: string,
  maxCodePoints: number,
  maxBytes: number,
): { readonly text: string; readonly bytes: number; readonly truncated: boolean } {
  const value = input.replace(/\u0000/g, '')
  const encoder = new TextEncoder()
  let text = ''
  let bytes = 0
  let codePoints = 0
  for (const codePoint of value) {
    if (codePoints >= maxCodePoints) return { text, bytes, truncated: true }
    const nextBytes = encoder.encode(codePoint).byteLength
    if (bytes + nextBytes > maxBytes) return { text, bytes, truncated: true }
    text += codePoint
    bytes += nextBytes
    codePoints += 1
  }
  return { text, bytes, truncated: false }
}
