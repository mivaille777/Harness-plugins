import type { BrowserSelectionCapture } from './types'

const LOCAL_CONTEXT_LIMIT = 900
const SECTION_CONTEXT_LIMIT = 6_000

export function captureBrowserSelection(
  doc: Document = document,
  win: Window = window,
): BrowserSelectionCapture | null {
  const input = captureActiveInput(doc, win)
  if (input !== null) return input

  const selection = win.getSelection()
  if (selection === null || selection.rangeCount < 1 || selection.isCollapsed) return null

  const text = selection.toString()
  if (text.trim().length === 0) return null

  let range: Range
  try {
    range = selection.getRangeAt(0)
  } catch {
    return null
  }

  const element = rangeElement(range)
  const container = semanticContainer(element)
  const nearby = nearbyText(container, text)
  const section = semanticSection(element, container)
  const topLevel = isTopLevelWindow(win)

  return {
    text,
    ...optionalText(doc.documentElement.lang, 'language'),
    ...optionalText(nearby.before, 'before'),
    ...optionalText(nearby.after, 'after'),
    ...optionalText(sectionText(section), 'sectionText'),
    ...optionalText(nearestHeading(element), 'heading'),
    frameUrl: win.location.href,
    title: doc.title,
    topLevel,
    capturedAt: Date.now(),
    ...(topLevel ? optionalGeometry(rangeGeometry(range, win)) : {}),
  }
}

function captureActiveInput(doc: Document, win: Window): BrowserSelectionCapture | null {
  const element = doc.activeElement
  const view = doc.defaultView
  if (view === null) return null
  const isTextArea = element instanceof view.HTMLTextAreaElement
  const isTextInput = element instanceof view.HTMLInputElement && isTextualInputType(element.type)
  if (!isTextArea && !isTextInput) return null

  const input = element as HTMLInputElement | HTMLTextAreaElement
  const start = input.selectionStart
  const end = input.selectionEnd
  if (start === null || end === null || end <= start) return null

  const text = input.value.slice(start, end)
  if (text.trim().length === 0) return null

  const topLevel = isTopLevelWindow(win)
  return {
    text,
    ...optionalText(doc.documentElement.lang, 'language'),
    ...optionalText(normalizeContext(input.value.slice(Math.max(0, start - LOCAL_CONTEXT_LIMIT), start)), 'before'),
    ...optionalText(normalizeContext(input.value.slice(end, end + LOCAL_CONTEXT_LIMIT)), 'after'),
    ...optionalText(nearestHeading(input), 'heading'),
    frameUrl: win.location.href,
    title: doc.title,
    topLevel,
    capturedAt: Date.now(),
    ...(topLevel ? optionalGeometry(rectToScreenGeometry(input.getBoundingClientRect(), win)) : {}),
  }
}

function isTextualInputType(type: string): boolean {
  return ['', 'text', 'search', 'url', 'tel', 'email', 'password'].includes(type.toLowerCase())
}

function rangeElement(range: Range): Element | null {
  const node = range.commonAncestorContainer
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element
  return node.parentElement
}

function semanticContainer(element: Element | null): Element | null {
  if (element === null) return null
  return (
    element.closest('p, li, td, th, blockquote, figcaption, article, section')
    ?? element.closest('div')
    ?? element
  )
}

function semanticSection(element: Element | null, fallback: Element | null): Element | null {
  return element?.closest('section, article, main') ?? fallback
}

function nearbyText(container: Element | null, selectedText: string): { before: string; after: string } {
  if (container === null) return { before: '', after: '' }
  const block = normalizeContext(readElementText(container))
  const needle = normalizeContext(selectedText)
  if (block.length === 0 || needle.length === 0) return { before: '', after: '' }

  const index = block.indexOf(needle)
  if (index < 0) {
    return {
      before: block.slice(0, LOCAL_CONTEXT_LIMIT),
      after: '',
    }
  }

  return {
    before: block.slice(Math.max(0, index - LOCAL_CONTEXT_LIMIT), index).trim(),
    after: block.slice(index + needle.length, index + needle.length + LOCAL_CONTEXT_LIMIT).trim(),
  }
}

function sectionText(section: Element | null): string {
  if (section === null) return ''
  return normalizeContext(readElementText(section)).slice(0, SECTION_CONTEXT_LIMIT)
}

function nearestHeading(element: Element | null): string {
  if (element === null) return ''

  const section = element.closest('section, article')
  const directHeading = section?.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')
  if (directHeading !== null && directHeading !== undefined) {
    return normalizeContext(readElementText(directHeading)).slice(0, 1024)
  }

  let current: Element | null = element
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    let sibling = current.previousElementSibling
    for (let steps = 0; sibling !== null && steps < 12; steps += 1) {
      if (/^H[1-6]$/.test(sibling.tagName)) {
        return normalizeContext(readElementText(sibling)).slice(0, 1024)
      }
      const nested = sibling.querySelector('h1, h2, h3, h4, h5, h6')
      if (nested !== null) return normalizeContext(readElementText(nested)).slice(0, 1024)
      sibling = sibling.previousElementSibling
    }
    current = current.parentElement
  }
  return ''
}

function readElementText(element: Element): string {
  const withInnerText = element as HTMLElement
  return typeof withInnerText.innerText === 'string'
    ? withInnerText.innerText
    : element.textContent ?? ''
}

function normalizeContext(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function rangeGeometry(range: Range, win: Window): BrowserSelectionCapture['geometry'] | undefined {
  try {
    return rectToScreenGeometry(range.getBoundingClientRect(), win)
  } catch {
    return undefined
  }
}

function rectToScreenGeometry(rect: DOMRect, win: Window): BrowserSelectionCapture['geometry'] | undefined {
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return undefined
  if (rect.width < 0 || rect.height < 0) return undefined

  const horizontalInset = Math.max(0, (safeNumber(win.outerWidth) - safeNumber(win.innerWidth)) / 2)
  const verticalInset = Math.max(0, safeNumber(win.outerHeight) - safeNumber(win.innerHeight))
  return {
    x: safeNumber(win.screenX) + horizontalInset + rect.left,
    y: safeNumber(win.screenY) + verticalInset + rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function isTopLevelWindow(win: Window): boolean {
  try {
    return win.top === win
  } catch {
    return false
  }
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function optionalText<K extends string>(value: string | undefined, key: K): Partial<Record<K, string>> {
  if (value === undefined || value.length === 0) return {}
  return { [key]: value } as Record<K, string>
}

function optionalGeometry(value: BrowserSelectionCapture['geometry'] | undefined): Partial<Pick<BrowserSelectionCapture, 'geometry'>> {
  return value === undefined ? {} : { geometry: value }
}
