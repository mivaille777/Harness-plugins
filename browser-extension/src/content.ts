import { captureBrowserSelection } from './selection'
import type { ContentSelectionMessage } from './types'

const SIGNATURE_WINDOW_MS = 150
let lastSignature = ''
let lastSentAt = 0

function publishSelection(): void {
  const capture = captureBrowserSelection()
  if (capture === null) return

  const now = Date.now()
  const signature = `${capture.frameUrl}\n${capture.text}`
  if (signature === lastSignature && now - lastSentAt < SIGNATURE_WINDOW_MS) return
  lastSignature = signature
  lastSentAt = now

  const message: ContentSelectionMessage = {
    type: 'dsh-selection-capture',
    payload: capture,
  }

  try {
    void chrome.runtime.sendMessage(message)
  } catch {
    // The extension/native companion may be unavailable. Never alter page selection behavior.
  }
}

document.addEventListener('mouseup', () => {
  window.setTimeout(publishSelection, 0)
}, true)

document.addEventListener('keyup', event => {
  if (event.key === 'Shift' || event.shiftKey) window.setTimeout(publishSelection, 0)
}, true)
