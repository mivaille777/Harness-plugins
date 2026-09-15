import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { runEc09TauriLensDriver } from './ec09-tauri-lens-driver.mjs'

const TAURI_DRIVER_SESSION_URL = 'http://127.0.0.1:4444/session'

export function hardenTauriSessionCapabilities(payload, userDataFolder) {
  const alwaysMatch = payload?.capabilities?.alwaysMatch
  const tauriOptions = alwaysMatch?.['tauri:options']
  if (alwaysMatch === null || typeof alwaysMatch !== 'object' || tauriOptions === null || typeof tauriOptions !== 'object') {
    return payload
  }

  if (typeof alwaysMatch.browserName !== 'string' || alwaysMatch.browserName.length === 0) {
    alwaysMatch.browserName = 'wry'
  }
  if (!Array.isArray(tauriOptions.args)) tauriOptions.args = []
  if (tauriOptions.webviewOptions === null || typeof tauriOptions.webviewOptions !== 'object' || Array.isArray(tauriOptions.webviewOptions)) {
    tauriOptions.webviewOptions = {}
  }
  if (typeof tauriOptions.webviewOptions.userDataFolder !== 'string' || tauriOptions.webviewOptions.userDataFolder.length === 0) {
    tauriOptions.webviewOptions.userDataFolder = userDataFolder
  }
  return payload
}

export async function runEc09TauriLensWebView2(env = process.env) {
  const userDataFolder = env.EC09_WEBVIEW2_USER_DATA_FOLDER?.trim()
    || join(env.RUNNER_TEMP?.trim() || tmpdir(), `dsh-ec09-webview2-${process.pid}-${Date.now()}`)
  await mkdir(userDataFolder, { recursive: true })

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === TAURI_DRIVER_SESSION_URL && method === 'POST' && typeof init?.body === 'string') {
      let payload
      try {
        payload = JSON.parse(init.body)
      } catch {
        payload = null
      }
      if (payload !== null) {
        const hardened = hardenTauriSessionCapabilities(payload, userDataFolder)
        return await originalFetch(input, { ...init, body: JSON.stringify(hardened) })
      }
    }
    return await originalFetch(input, init)
  }

  try {
    return await runEc09TauriLensDriver(env)
  } finally {
    globalThis.fetch = originalFetch
    if (env.EC09_KEEP_WEBVIEW2_PROFILE !== '1') await rm(userDataFolder, { recursive: true, force: true }).catch(() => undefined)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runEc09TauriLensWebView2()
  console.log(JSON.stringify({ status: report.status, reason: report.diagnostics.reason, report: process.env.DSH_LENS_REPORT_PATH ?? null }))
  process.exitCode = report.status === 'PASS' ? 0 : 1
}
