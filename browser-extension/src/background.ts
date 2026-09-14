import { buildBrowserSnapshot } from './snapshot'
import type { ContentSelectionMessage } from './types'

const NATIVE_HOST = 'io.github.mivaille777.dsh_selection_companion'
// Browser Native Messaging forwards this envelope directly to the same Rust
// Protocol V4 parser used by named-pipe clients. Keep this in lockstep with
// src/bridge/protocol.ts and native/src-tauri/src/protocol.rs.
const PROTOCOL_VERSION = 4
let nativePort: chrome.runtime.Port | null = null

function ensureNativePort(): chrome.runtime.Port | null {
  if (nativePort !== null) return nativePort
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST)
    port.onDisconnect.addListener(() => {
      if (nativePort === port) nativePort = null
    })
    port.onMessage.addListener(() => {
      // Acknowledgements are intentionally not persisted in extension state.
    })
    nativePort = port
    return port
  } catch {
    nativePort = null
    return null
  }
}

function postSelection(message: ContentSelectionMessage, sender: chrome.runtime.MessageSender): void {
  const snapshot = buildBrowserSnapshot(message.payload, {
    tabUrl: sender.tab?.url,
    tabTitle: sender.tab?.title,
  })
  const envelope = {
    protocol: PROTOCOL_VERSION,
    id: `browser-selection-${snapshot.id}`,
    type: 'selection.update',
    payload: { snapshot },
  }

  try {
    ensureNativePort()?.postMessage(envelope)
  } catch {
    nativePort = null
    try {
      ensureNativePort()?.postMessage(envelope)
    } catch {
      // Browser interaction must remain unaffected if the native host is unavailable.
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isContentSelectionMessage(message)) return
  postSelection(message, sender)
})

function isContentSelectionMessage(value: unknown): value is ContentSelectionMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ContentSelectionMessage>
  return candidate.type === 'dsh-selection-capture'
    && typeof candidate.payload === 'object'
    && candidate.payload !== null
    && typeof candidate.payload.text === 'string'
    && candidate.payload.text.trim().length > 0
}
