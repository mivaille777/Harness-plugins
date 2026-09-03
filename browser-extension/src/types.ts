export interface BrowserSelectionCapture {
  readonly text: string
  readonly language?: string
  readonly before?: string
  readonly after?: string
  readonly sectionText?: string
  readonly heading?: string
  readonly frameUrl: string
  readonly title: string
  readonly topLevel: boolean
  readonly capturedAt: number
  readonly geometry?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface BrowserSenderMeta {
  readonly tabUrl?: string
  readonly tabTitle?: string
}

export interface BrowserSelectionSnapshot {
  readonly id: string
  readonly revision: number
  readonly capturedAt: number
  readonly selection: {
    readonly text: string
    readonly language?: string
  }
  readonly source: {
    readonly kind: 'browser'
    readonly app: string
    readonly windowTitle?: string
  }
  readonly document: {
    readonly title?: string
    readonly url?: string
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
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly provider: 'browser-dom'
  readonly confidence: number
}

export interface ContentSelectionMessage {
  readonly type: 'dsh-selection-capture'
  readonly payload: BrowserSelectionCapture
}
