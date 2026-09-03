export const SELECTION_SOURCE_KINDS = ['browser', 'pdf', 'word', 'desktop'] as const

export type SelectionSourceKind = (typeof SELECTION_SOURCE_KINDS)[number]

export interface SelectionSnapshot {
  readonly id: string
  readonly revision: number
  readonly capturedAt: number

  readonly selection: {
    readonly text: string
    readonly language?: string
  }

  readonly source: {
    readonly kind: SelectionSourceKind
    readonly app?: string
    readonly process?: string
    readonly windowTitle?: string
  }

  readonly document?: {
    readonly title?: string
    readonly url?: string
    readonly filePath?: string
    readonly section?: string
    readonly frameUrl?: string
  }

  readonly context: {
    readonly before?: string
    readonly after?: string
    readonly sectionText?: string
    readonly pageAvailable: boolean
  }

  readonly capabilities: {
    readonly localContext: boolean
    readonly sectionContext: boolean
    readonly pageContext: boolean
    readonly screenshot: boolean
  }

  readonly geometry?: {
    readonly monitorId?: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }

  readonly provider: string
  readonly confidence: number
}

export class SelectionSnapshotValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SelectionSnapshotValidationError'
  }
}

/**
 * Validate, detach, and deeply freeze a snapshot before it enters Harness state.
 * The selected text is preserved byte-for-byte; whitespace-only selections are rejected.
 */
export function normalizeSelectionSnapshot(input: SelectionSnapshot): SelectionSnapshot {
  assertNonEmptyText(input.id, 'id')
  if (input.id.length > 256) fail('id must be at most 256 characters')
  assertNonNegativeInteger(input.revision, 'revision')
  assertNonNegativeInteger(input.capturedAt, 'capturedAt')
  assertNonEmptyText(input.selection.text, 'selection.text', true)
  assertSourceKind(input.source.kind)
  assertBoolean(input.context.pageAvailable, 'context.pageAvailable')
  assertBoolean(input.capabilities.localContext, 'capabilities.localContext')
  assertBoolean(input.capabilities.sectionContext, 'capabilities.sectionContext')
  assertBoolean(input.capabilities.pageContext, 'capabilities.pageContext')
  assertBoolean(input.capabilities.screenshot, 'capabilities.screenshot')
  assertNonEmptyText(input.provider, 'provider')

  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    fail('confidence must be a finite number between 0 and 1')
  }

  if (input.geometry !== undefined) {
    assertFiniteNumber(input.geometry.x, 'geometry.x')
    assertFiniteNumber(input.geometry.y, 'geometry.y')
    assertFiniteNumber(input.geometry.width, 'geometry.width')
    assertFiniteNumber(input.geometry.height, 'geometry.height')
    if (input.geometry.width < 0 || input.geometry.height < 0) {
      fail('geometry width and height must be non-negative')
    }
  }

  return deepFreeze(structuredClone(input))
}

function assertSourceKind(value: string): asserts value is SelectionSourceKind {
  if (!(SELECTION_SOURCE_KINDS as readonly string[]).includes(value)) {
    fail(`source.kind must be one of: ${SELECTION_SOURCE_KINDS.join(', ')}`)
  }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`)
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number`)
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative safe integer`)
  }
}

function assertNonEmptyText(value: unknown, field: string, allowSurroundingWhitespace = false): asserts value is string {
  if (typeof value !== 'string') fail(`${field} must be a string`)
  const meaningful = allowSurroundingWhitespace ? value.trim() : value
  if (meaningful.length === 0) fail(`${field} must not be empty`)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value

  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

function fail(message: string): never {
  throw new SelectionSnapshotValidationError(message)
}
