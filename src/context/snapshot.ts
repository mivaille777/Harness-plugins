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
 * Parse an untrusted value into the canonical selection domain model.
 * Unknown fields are discarded, selected text is preserved exactly, and the
 * returned snapshot is detached and deeply frozen.
 */
export function normalizeSelectionSnapshot(input: unknown): SelectionSnapshot {
  const root = requireRecord(input, 'snapshot')
  const selection = requireRecord(root.selection, 'selection')
  const source = requireRecord(root.source, 'source')
  const context = requireRecord(root.context, 'context')
  const capabilities = requireRecord(root.capabilities, 'capabilities')

  const id = requireNonEmptyText(root.id, 'id')
  if (id.length > 256) fail('id must be at most 256 characters')

  const sourceKind = requireSourceKind(source.kind)
  const confidence = requireFiniteNumber(root.confidence, 'confidence')
  if (confidence < 0 || confidence > 1) {
    fail('confidence must be a finite number between 0 and 1')
  }

  const geometry = root.geometry === undefined
    ? undefined
    : parseGeometry(root.geometry)

  const document = root.document === undefined
    ? undefined
    : parseDocument(root.document)

  const snapshot: SelectionSnapshot = {
    id,
    revision: requireNonNegativeInteger(root.revision, 'revision'),
    capturedAt: requireNonNegativeInteger(root.capturedAt, 'capturedAt'),
    selection: {
      text: requireMeaningfulSelection(selection.text),
      ...optionalStringProperty(selection.language, 'selection.language', 'language'),
    },
    source: {
      kind: sourceKind,
      ...optionalStringProperty(source.app, 'source.app', 'app'),
      ...optionalStringProperty(source.process, 'source.process', 'process'),
      ...optionalStringProperty(source.windowTitle, 'source.windowTitle', 'windowTitle'),
    },
    ...(document === undefined ? {} : { document }),
    context: {
      ...optionalStringProperty(context.before, 'context.before', 'before'),
      ...optionalStringProperty(context.after, 'context.after', 'after'),
      ...optionalStringProperty(context.sectionText, 'context.sectionText', 'sectionText'),
      pageAvailable: requireBoolean(context.pageAvailable, 'context.pageAvailable'),
    },
    capabilities: {
      localContext: requireBoolean(capabilities.localContext, 'capabilities.localContext'),
      sectionContext: requireBoolean(capabilities.sectionContext, 'capabilities.sectionContext'),
      pageContext: requireBoolean(capabilities.pageContext, 'capabilities.pageContext'),
      screenshot: requireBoolean(capabilities.screenshot, 'capabilities.screenshot'),
    },
    ...(geometry === undefined ? {} : { geometry }),
    provider: requireNonEmptyText(root.provider, 'provider'),
    confidence,
  }

  return deepFreeze(snapshot)
}

function parseDocument(value: unknown): NonNullable<SelectionSnapshot['document']> {
  const document = requireRecord(value, 'document')
  return {
    ...optionalStringProperty(document.title, 'document.title', 'title'),
    ...optionalStringProperty(document.url, 'document.url', 'url'),
    ...optionalStringProperty(document.filePath, 'document.filePath', 'filePath'),
    ...optionalStringProperty(document.section, 'document.section', 'section'),
    ...optionalStringProperty(document.frameUrl, 'document.frameUrl', 'frameUrl'),
  }
}

function parseGeometry(value: unknown): NonNullable<SelectionSnapshot['geometry']> {
  const geometry = requireRecord(value, 'geometry')
  const width = requireFiniteNumber(geometry.width, 'geometry.width')
  const height = requireFiniteNumber(geometry.height, 'geometry.height')
  if (width < 0 || height < 0) fail('geometry width and height must be non-negative')

  return {
    ...optionalStringProperty(geometry.monitorId, 'geometry.monitorId', 'monitorId'),
    x: requireFiniteNumber(geometry.x, 'geometry.x'),
    y: requireFiniteNumber(geometry.y, 'geometry.y'),
    width,
    height,
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireSourceKind(value: unknown): SelectionSourceKind {
  if (typeof value !== 'string' || !(SELECTION_SOURCE_KINDS as readonly string[]).includes(value)) {
    fail(`source.kind must be one of: ${SELECTION_SOURCE_KINDS.join(', ')}`)
  }
  return value as SelectionSourceKind
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`)
  return value
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number`)
  return value
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(`${field} must be a non-negative safe integer`)
  }
  return value
}

function requireNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} must be a string`)
  if (value.length === 0) fail(`${field} must not be empty`)
  return value
}

function requireMeaningfulSelection(value: unknown): string {
  if (typeof value !== 'string') fail('selection.text must be a string')
  if (value.trim().length === 0) fail('selection.text must not be empty')
  return value
}

function optionalStringProperty<K extends string>(
  value: unknown,
  field: string,
  key: K,
): Partial<Record<K, string>> {
  if (value === undefined) return {}
  if (typeof value !== 'string') fail(`${field} must be a string when provided`)
  return { [key]: value } as Record<K, string>
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
