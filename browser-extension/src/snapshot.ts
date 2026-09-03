import type {
  BrowserSelectionCapture,
  BrowserSelectionSnapshot,
  BrowserSenderMeta,
} from './types'

export function buildBrowserSnapshot(
  capture: BrowserSelectionCapture,
  sender: BrowserSenderMeta,
  idFactory: () => string = defaultId,
): BrowserSelectionSnapshot {
  const url = sender.tabUrl?.trim() || capture.frameUrl
  const title = sender.tabTitle?.trim() || capture.title
  const localContext = Boolean(capture.before || capture.after)
  const sectionContext = Boolean(capture.sectionText)

  return {
    id: `browser-${idFactory()}`,
    revision: 1,
    capturedAt: capture.capturedAt,
    selection: {
      text: capture.text,
      ...(capture.language ? { language: capture.language } : {}),
    },
    source: {
      kind: 'browser',
      app: 'Chrome/Edge',
      ...(title ? { windowTitle: title } : {}),
    },
    document: {
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
      ...(capture.heading ? { section: capture.heading } : {}),
      ...(capture.frameUrl ? { frameUrl: capture.frameUrl } : {}),
    },
    context: {
      ...(capture.before ? { before: capture.before } : {}),
      ...(capture.after ? { after: capture.after } : {}),
      ...(capture.sectionText ? { sectionText: capture.sectionText } : {}),
      pageAvailable: false,
    },
    capabilities: {
      localContext,
      sectionContext,
      pageContext: false,
      screenshot: false,
    },
    ...(capture.geometry ? { geometry: capture.geometry } : {}),
    provider: 'browser-dom',
    confidence: capture.topLevel ? 0.98 : 0.94,
  }
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
