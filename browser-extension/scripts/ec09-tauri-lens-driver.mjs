import { chromium } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  createEc08PipeClient,
  EC08_PROTOCOL,
} from '../../scripts/ec08-session-model-boundary.mjs'
import { summarizeModelRequest } from '../../scripts/ec07-model-boundary.mjs'
import {
  createRunDirectories,
  dshInvocation,
  preflight,
  redactOutput,
  removeOwnedPath,
  runProcess,
} from '../../scripts/r07-runner.mjs'

export const EC09_LENS_SELECTION = 'EC09_LENS_SELECTED_TOKEN_64109'
export const EC09_LENS_SECTION = 'EC09_LENS_SECTION_CONTEXT_73517'
export const EC09_LENS_NEWER_GLOBAL = 'EC09_NEWER_GLOBAL_MUST_NOT_LEAK_81233'
export const EC09_LENS_MODEL_TOKEN = 'EC09_LENS_MODEL_OK'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const extensionRoot = resolve(here, '..')
const WEBDRIVER_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
const MAX_OUTPUT_BYTES = 128 * 1024

function timeoutPromise(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms))
}

async function waitUntil(check, label, timeoutMs = 15_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, intervalMs))
  }
  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`)
}

function spawnDsh(invocation, { cwd, env }) {
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    shell: invocation.shell,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const append = (current, chunk) => {
    const next = current + chunk.toString()
    return next.length > MAX_OUTPUT_BYTES ? next.slice(-MAX_OUTPUT_BYTES) : next
  }
  child.stdout?.on('data', chunk => { stdout = append(stdout, chunk) })
  child.stderr?.on('data', chunk => { stderr = append(stderr, chunk) })
  return {
    child,
    output: () => ({ stdout, stderr }),
    stop() {
      if (child.exitCode !== null) return
      if (process.platform === 'win32' && child.pid !== undefined) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('error', () => undefined)
      } else child.kill('SIGTERM')
    },
  }
}

async function connectPipe(endpoint, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolveSocket, rejectSocket) => {
        const socket = connect(endpoint)
        socket.once('connect', () => resolveSocket(socket))
        socket.once('error', rejectSocket)
      })
    } catch (error) {
      lastError = error
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
  }
  throw new Error(`cannot connect EC-09 Lens runner to ${endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function writeSseChunk(response, chunk) {
  response.write(`data: ${JSON.stringify(chunk)}\n\n`)
}

async function startModelGate() {
  const requests = []
  let bootstrapResponse = null
  let bootstrapResolve
  let targetResolve
  let targetResponse = null
  let expectedPreview = null
  const bootstrapStarted = new Promise(resolveBootstrap => { bootstrapResolve = resolveBootstrap })
  const targetStarted = new Promise(resolveTarget => { targetResolve = resolveTarget })

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      let parsed = null
      try { parsed = JSON.parse(body) } catch { parsed = null }
      const serialized = parsed === null ? '' : JSON.stringify(parsed.messages ?? [])
      const summary = parsed === null
        ? { parseError: true, model: null, messageCount: 0, expected: {}, forbidden: {}, messagesSha256: null }
        : summarizeModelRequest(parsed, [EC09_LENS_SELECTION, EC09_LENS_SECTION], [EC09_LENS_NEWER_GLOBAL])
      const observation = {
        method: request.method ?? null,
        path: request.url ?? null,
        ...summary,
        previewObserved: expectedPreview !== null && serialized.includes(expectedPreview),
      }
      requests.push(observation)
      const target = observation.parseError !== true
        && observation.expected?.[EC09_LENS_SELECTION] === true
        && observation.expected?.[EC09_LENS_SECTION] === true
      if (target) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'close',
        })
        writeSseChunk(response, { id: 'ec09-lens', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' } }] })
        writeSseChunk(response, { id: 'ec09-lens', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'EC09_STREAMING_VISIBLE ' } }] })
        targetResponse = response
        targetResolve(observation)
        return
      }
      if (bootstrapResponse === null) {
        bootstrapResponse = response
        bootstrapResolve(observation)
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
      writeSseChunk(response, { id: 'ec09-other', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'EC09_OTHER' } }] })
      writeSseChunk(response, { id: 'ec09-other', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('EC-09 Lens model gate did not expose a port')

  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    bootstrapStarted,
    targetStarted,
    setExpectedPreview(value) { expectedPreview = value },
    completeTarget() {
      if (targetResponse === null) return
      const response = targetResponse
      targetResponse = null
      writeSseChunk(response, { id: 'ec09-lens', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: EC09_LENS_MODEL_TOKEN } }] })
      writeSseChunk(response, { id: 'ec09-lens', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      response.end('data: [DONE]\n\n')
    },
    releaseBootstrap() {
      if (bootstrapResponse === null) return
      const response = bootstrapResponse
      bootstrapResponse = null
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
      writeSseChunk(response, { id: 'ec09-bootstrap', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'EC09_BOOTSTRAP_RELEASED' } }] })
      writeSseChunk(response, { id: 'ec09-bootstrap', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      response.end('data: [DONE]\n\n')
    },
    async close() {
      this.completeTarget()
      this.releaseBootstrap()
      if (server.listening) await new Promise(resolveClose => server.close(() => resolveClose()))
    },
  }
}

async function startFixtureServer() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>EC09 Lens Browser Fixture</title></head><body>
  <main><section id="scope"><h2>Authorized design context</h2>
  <p id="target">before ${EC09_LENS_SELECTION} after</p>
  <p>${EC09_LENS_SECTION}</p></section></main></body></html>`
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(html)
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('EC-09 Lens fixture did not expose a port')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    async close() {
      if (server.listening) await new Promise(resolveClose => server.close(() => resolveClose()))
    },
  }
}

async function registerNativeHost(extensionId, binaryPath, env) {
  const result = await runProcess('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', join(repoRoot, 'scripts', 'register-native-host.ps1'),
    '-ExtensionId', extensionId,
    '-BinaryPath', binaryPath,
    '-Browser', 'Chromium',
  ], { cwd: repoRoot, env, timeoutMs: 20_000 })
  if (result.code !== 0) throw new Error(`native host registration failed: ${redactOutput(result.stderr).trim()}`)
}

async function unregisterNativeHost(env) {
  await runProcess('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', join(repoRoot, 'scripts', 'unregister-native-host.ps1'),
    '-Browser', 'Chromium',
  ], { cwd: repoRoot, env, timeoutMs: 20_000 })
}

async function createRealBrowserSelection({ extensionDist, nativeHost, endpoint, fixtureUrl, env, dirs }) {
  const context = await chromium.launchPersistentContext(join(dirs.root, 'chromium-profile'), {
    channel: 'chromium',
    headless: true,
    env: { ...env, DSH_SELECTION_COMPANION_PIPE: endpoint },
    args: [`--disable-extensions-except=${extensionDist}`, `--load-extension=${extensionDist}`],
  })
  let worker = context.serviceWorkers()[0]
  if (worker === undefined) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionId = worker.url().split('/')[2]
  if (extensionId === undefined || !/^[a-p]{32}$/.test(extensionId)) throw new Error(`unexpected extension id ${extensionId ?? 'missing'}`)
  await registerNativeHost(extensionId, nativeHost, env)
  const page = await context.newPage()
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#target')
  await page.evaluate(token => {
    const target = document.querySelector('#target')
    const text = target?.firstChild
    if (target === null || text === null) throw new Error('selection fixture target is missing')
    const source = text.textContent ?? ''
    const start = source.indexOf(token)
    if (start < 0) throw new Error('selection sentinel not found')
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, start + token.length)
    const selection = window.getSelection()
    if (selection === null) throw new Error('window selection unavailable')
    selection.removeAllRanges()
    selection.addRange(range)
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
  }, EC09_LENS_SELECTION)
  return { context, extensionId }
}

function newerGlobalSnapshot() {
  return {
    id: `ec09-newer-${randomUUID()}`,
    revision: 2,
    capturedAt: Date.now(),
    selection: { text: EC09_LENS_NEWER_GLOBAL },
    source: { kind: 'browser', app: 'Chromium' },
    document: { title: 'Newer unrelated selection', url: 'https://example.test/newer' },
    context: { before: 'newer-before', after: 'newer-after', sectionText: EC09_LENS_NEWER_GLOBAL, pageAvailable: false },
    capabilities: { localContext: true, sectionContext: true, pageContext: false, screenshot: false },
    provider: 'ec09-negative-control',
    confidence: 1,
  }
}

function createWebDriver(base = 'http://127.0.0.1:4444') {
  let sessionId = null
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let payload
    try { payload = await response.json() } catch { payload = { value: { error: 'invalid response', message: await response.text().catch(() => '') } } }
    const error = payload?.value?.error
    if (!response.ok || typeof error === 'string') {
      throw new Error(`WebDriver ${method} ${path} failed: ${payload?.value?.message ?? error ?? response.status}`)
    }
    return payload?.value
  }
  async function find(selector) {
    if (sessionId === null) throw new Error('WebDriver session has not started')
    const value = await request(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
    const id = value?.[WEBDRIVER_ELEMENT_KEY]
    if (typeof id !== 'string') throw new Error(`WebDriver did not return an element for ${selector}`)
    return id
  }
  return {
    async waitReady(timeoutMs = 20_000) {
      await waitUntil(async () => {
        try { await request('/status'); return true } catch { return false }
      }, 'tauri-driver status', timeoutMs)
    },
    async attach(debuggerAddress) {
      const value = await request('/session', 'POST', {
        capabilities: {
          alwaysMatch: {
            browserName: 'webview2',
            'ms:edgeChromium': true,
            'ms:edgeOptions': { debuggerAddress },
          },
        },
      })
      sessionId = value?.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('tauri-driver did not return a sessionId')
      return sessionId
    },
    async execute(script, args = []) {
      return await request(`/session/${sessionId}/execute/sync`, 'POST', { script, args })
    },
    async click(selector) {
      const id = await find(selector)
      await request(`/session/${sessionId}/element/${encodeURIComponent(id)}/click`, 'POST', {})
    },
    async text(selector) {
      const id = await find(selector)
      return await request(`/session/${sessionId}/element/${encodeURIComponent(id)}/text`)
    },
    async screenshot(path) {
      const encoded = await request(`/session/${sessionId}/screenshot`)
      if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('WebDriver returned an empty screenshot')
      await writeFile(path, Buffer.from(encoded, 'base64'))
    },
    async close() {
      if (sessionId === null) return
      const current = sessionId
      sessionId = null
      await request(`/session/${current}`, 'DELETE').catch(() => undefined)
    },
  }
}

function spawnTauriDriver(env) {
  const command = env.EC09_TAURI_DRIVER?.trim() || 'tauri-driver.exe'
  const child = spawn(command, [], { cwd: repoRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT_BYTES) })
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_BYTES) })
  return {
    child,
    output: () => ({ stdout, stderr }),
    stop() {
      if (child.exitCode === null) child.kill()
    },
  }
}


async function reserveLocalPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise(resolveClose => server.close(() => resolveClose()))
    throw new Error('could not reserve a WebView2 remote debugging port')
  }
  const port = address.port
  await new Promise(resolveClose => server.close(() => resolveClose()))
  return port
}

function spawnTauriApplication(application, env, debugPort, userDataFolder) {
  const inheritedArgs = env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS?.trim()
  const remoteDebugging = `--remote-debugging-port=${debugPort}`
  const childEnv = {
    ...env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: inheritedArgs ? `${inheritedArgs} ${remoteDebugging}` : remoteDebugging,
    WEBVIEW2_USER_DATA_FOLDER: userDataFolder,
  }
  const child = spawn(application, [], {
    cwd: dirname(application),
    env: childEnv,
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-MAX_OUTPUT_BYTES) })
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_BYTES) })
  return {
    child,
    output: () => ({ stdout, stderr }),
    stop() {
      if (child.exitCode !== null) return
      if (process.platform === 'win32' && child.pid !== undefined) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.once('error', () => undefined)
      } else child.kill('SIGTERM')
    },
  }
}

async function waitForWebView2Debugger(debugPort, applicationProcess, timeoutMs = 20_000) {
  await waitUntil(async () => {
    if (applicationProcess.child.exitCode !== null) {
      const output = applicationProcess.output()
      throw new Error(`Tauri application exited before WebView2 debugging became available (code ${applicationProcess.child.exitCode}): ${redactOutput(output.stderr).trim().slice(-2_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: AbortSignal.timeout(750),
      })
      return response.ok
    } catch {
      return false
    }
  }, 'Tauri WebView2 remote debugging endpoint', timeoutMs, 100)
}

async function waitForBrowserSnapshot(client, timeoutMs = 15_000) {
  return await waitUntil(async () => {
    const current = await client.request('selection.current', {})
    const snapshot = current.payload?.snapshot
    return snapshot?.selection?.text?.includes(EC09_LENS_SELECTION) === true ? snapshot : null
  }, 'browser selection in Harness', timeoutMs, 150)
}

async function waitForSessionHistory(client, sessionId, timeoutMs = 20_000) {
  return await waitUntil(async () => {
    const history = await client.request('session.history', { sessionId, afterCursor: 0, limit: 32 })
    const entries = Array.isArray(history.payload?.entries) ? history.payload.entries : []
    const user = entries.find(entry => typeof entry?.text === 'string'
      && entry.text.includes(EC09_LENS_SELECTION)
      && entry.text.includes(EC09_LENS_SECTION))
    const assistant = entries.find(entry => typeof entry?.text === 'string' && entry.text.includes(EC09_LENS_MODEL_TOKEN))
    if (user === undefined || assistant === undefined) return null
    return { user, assistant, entries }
  }, 'durable Session history', timeoutMs, 150)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export async function runEc09TauriLensDriver(env = process.env) {
  const reportPath = resolve(env.DSH_LENS_REPORT_PATH ?? join(tmpdir(), 'ec09-tauri-lens-driver.json'))
  const screenshotDir = resolve(env.DSH_LENS_SCREENSHOT_DIR ?? join(tmpdir(), 'ec09-tauri-lens-screenshots'))
  await mkdir(dirname(reportPath), { recursive: true })
  await mkdir(screenshotDir, { recursive: true })
  const dirs = await createRunDirectories('dsh-selection-companion-ec09-lens-')
  const endpoint = env.EC09_PIPE ?? String.raw`\\.\pipe\dsh-selection-companion-ec09-lens-${process.pid}-${Date.now()}`
  const extensionDist = resolve(env.EC09_EXTENSION_DIST ?? join(extensionRoot, 'dist'))
  const nativeHost = resolve(env.EC09_NATIVE_HOST ?? join(repoRoot, 'native', 'src-tauri', 'target', 'debug', 'dsh-selection-companion-host.exe'))
  const application = resolve(env.EC09_TAURI_APPLICATION ?? join(repoRoot, 'native', 'src-tauri', 'target', 'debug', 'dsh-selection-companion-native.exe'))
  const report = {
    schemaVersion: Number(env.DSH_LENS_DRIVER_SCHEMA_VERSION ?? 2),
    status: 'FAIL',
    application: 'tauri',
    realWindow: false,
    realSelection: false,
    browser: 'chromium',
    states: [],
    assertions: [],
    contextAuthorization: null,
    sessionEvidence: null,
    screenshots: [],
    diagnostics: { reason: null, modelRequests: [], application, nativeHost, extensionDist },
  }

  let gate
  let fixture
  let dsh
  let browser
  let pipeClient
  let tauriDriver
  let tauriApplication
  const webdriver = createWebDriver()
  let nativeHostRegistered = false
  try {
    const host = await preflight(env)
    if (host.failures.length > 0) throw new Error(host.failures.join('; '))
    for (const [label, path] of [['extension manifest', join(extensionDist, 'manifest.json')], ['native host', nativeHost], ['Tauri application', application]]) {
      if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`)
    }

    gate = await startModelGate()
    fixture = await startFixtureServer()
    const runEnv = {
      ...env,
      DSH_HOME: dirs.home,
      DSH_SELECTION_COMPANION_PIPE: endpoint,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DEEPSEEK_API_KEY: 'ec09-lens-local-key',
      DEEPSEEK_BASE_URL: gate.url,
    }
    delete runEnv.DSH_SELECTION_COMPANION_DISABLE_BRIDGE

    const installInvocation = dshInvocation(['plugin', '--profile', 'headless', 'add', `file:${repoRoot.replaceAll('\\', '/')}`], runEnv)
    const install = await runProcess(installInvocation.command, installInvocation.args, {
      cwd: dirs.workspace,
      env: runEnv,
      timeoutMs: 180_000,
      shell: installInvocation.shell,
      windowsVerbatimArguments: installInvocation.windowsVerbatimArguments,
    })
    if (install.code !== 0) throw new Error(`plugin install failed: ${redactOutput(install.stderr).trim()}`)

    const invocation = dshInvocation(['--profile', 'headless', 'EC09 Lens bootstrap. Wait for deterministic local model.'], runEnv)
    dsh = spawnDsh(invocation, { cwd: dirs.workspace, env: runEnv })
    await Promise.race([gate.bootstrapStarted, timeoutPromise(30_000, 'EC-09 Lens bootstrap')])

    const socket = await connectPipe(endpoint)
    pipeClient = createEc08PipeClient(socket)
    const hello = await pipeClient.request('bridge.hello', {
      client: { name: 'ec09-tauri-lens-driver', version: '1.0.0', platform: 'windows' },
      supportedProtocols: [EC08_PROTOCOL],
    })
    if (hello.type !== 'bridge.hello.result' || hello.payload?.protocol !== EC08_PROTOCOL) throw new Error('Protocol V4 bridge negotiation failed')

    browser = await createRealBrowserSelection({ extensionDist, nativeHost, endpoint, fixtureUrl: fixture.url, env: runEnv, dirs })
    nativeHostRegistered = true
    const snapshot = await waitForBrowserSnapshot(pipeClient)
    if (!snapshot.context?.sectionText?.includes(EC09_LENS_SECTION)) throw new Error('real browser snapshot does not contain the section sentinel')
    report.realSelection = true
    report.assertions.push('browser-selection-captured')

    const debugPort = await reserveLocalPort()
    const webviewUserDataFolder = join(dirs.root, 'webview2-profile')
    await mkdir(webviewUserDataFolder, { recursive: true })
    tauriApplication = spawnTauriApplication(application, runEnv, debugPort, webviewUserDataFolder)
    await waitForWebView2Debugger(debugPort, tauriApplication)
    tauriDriver = spawnTauriDriver(runEnv)
    await webdriver.waitReady()
    await webdriver.attach(`127.0.0.1:${debugPort}`)
    report.realWindow = true
    report.diagnostics.webview2DebugPort = debugPort

    await waitUntil(async () => (await webdriver.execute(`return document.querySelector('[data-testid="selected-text"]')?.textContent || ''`)).includes(EC09_LENS_SELECTION), 'Tauri selected-text')
    const idlePath = join(screenshotDir, 'idle.png')
    await webdriver.screenshot(idlePath)
    report.states.push('idle')
    report.screenshots.push({ state: 'idle', path: 'idle.png' })

    await waitUntil(async () => await webdriver.execute(`const b=document.querySelector('.session-controls button.secondary'); return !!b && !b.disabled`), 'New session button')
    await webdriver.click('.session-controls button.secondary')
    const newSessionId = await waitUntil(async () => {
      const value = await webdriver.execute(`return document.querySelector('.session-controls select')?.value || ''`)
      return typeof value === 'string' && value.length > 0 ? value : null
    }, 'new Lens session id')

    await webdriver.click('[data-testid="captured-context"] > summary')
    await waitUntil(async () => await webdriver.execute(`return !!document.querySelector('#context-scope option[value="section"]')`), 'section scope option')
    await webdriver.execute(`const s=document.querySelector('#context-scope'); s.value='section'; s.dispatchEvent(new Event('change',{bubbles:true})); return s.value`)
    await webdriver.click('.context-controls button.secondary')
    await waitUntil(async () => (await webdriver.execute(`return document.querySelector('[data-testid="captured-context"]')?.textContent || ''`)).includes(EC09_LENS_SECTION), 'expanded section context')
    report.assertions.push('expanded-context-loaded')

    await waitUntil(async () => await webdriver.execute(`return !!document.querySelector('[data-testid="authorize-context"]')`), 'explicit authorization button')
    await webdriver.click('[data-testid="authorize-context"]')
    const authorizationText = await waitUntil(async () => {
      const value = await webdriver.execute(`return document.querySelector('[data-testid="request-context-authorization"]')?.textContent || ''`)
      return typeof value === 'string' && value.toLowerCase().includes('section') ? value : null
    }, 'section authorization status')
    void authorizationText
    report.assertions.push('expanded-scope-authorized')
    const authorizedPath = join(screenshotDir, 'authorized.png')
    await webdriver.screenshot(authorizedPath)
    report.states.push('authorized')
    report.screenshots.push({ state: 'authorized', path: 'authorized.png' })

    await webdriver.click('[data-testid="request-material-preview-panel"] > summary')
    const preview = await webdriver.text('[data-testid="request-material-preview"]')
    if (!preview.includes(EC09_LENS_SELECTION) || !preview.includes(EC09_LENS_SECTION)) throw new Error('request material preview is missing authorized sentinels')
    if (!preview.includes(`Snapshot: ${snapshot.id}`) || !preview.includes(`Revision: ${snapshot.revision}`)) throw new Error('request material preview is not bound to the browser snapshot identity')
    if (!preview.includes('Authorized scope: section') || !preview.includes('Actual scope: section')) throw new Error('request material preview is not section-authorized')
    gate.setExpectedPreview(preview)
    const materialPath = join(screenshotDir, 'material.png')
    await webdriver.screenshot(materialPath)
    report.states.push('material')
    report.screenshots.push({ state: 'material', path: 'material.png' })

    const newer = newerGlobalSnapshot()
    const updated = await pipeClient.request('selection.update', { snapshot: newer })
    if (updated.type !== 'selection.updated' || updated.payload?.accepted !== true) throw new Error('negative-control newer global selection was not accepted')
    const previewAfterGlobalChange = await webdriver.text('[data-testid="request-material-preview"]')
    const materialFrozen = previewAfterGlobalChange === preview && !previewAfterGlobalChange.includes(EC09_LENS_NEWER_GLOBAL)
    if (!materialFrozen) throw new Error('authorized request material changed after an unrelated global selection update')

    await webdriver.click('[data-testid="explain-action"]')
    const target = await Promise.race([gate.targetStarted, timeoutPromise(30_000, 'EC-09 Lens target model request')])
    if (target.forbidden?.[EC09_LENS_NEWER_GLOBAL] !== false) throw new Error('newer global selection leaked into model request')
    if (target.previewObserved !== true) throw new Error('model request did not contain the exact authorized material preview')
    await waitUntil(async () => (await webdriver.execute(`return document.querySelector('[data-testid="selection-lens"]')?.getAttribute('data-phase') || ''`)) === 'streaming', 'Lens streaming phase')
    const streamingPath = join(screenshotDir, 'streaming.png')
    await webdriver.screenshot(streamingPath)
    report.states.push('streaming')
    report.screenshots.push({ state: 'streaming', path: 'streaming.png' })

    gate.completeTarget()
    const history = await waitForSessionHistory(pipeClient, newSessionId)
    const requestId = history.user.requestId
    if (typeof requestId !== 'string' || requestId.length === 0) throw new Error('durable Session history did not expose the Lens requestId')
    if (history.user.text.includes(EC09_LENS_NEWER_GLOBAL)) throw new Error('newer global selection leaked into durable Session transcript')
    await webdriver.click('.history-drawer > summary')
    await waitUntil(async () => {
      const text = await webdriver.execute(`return document.querySelector('.history')?.textContent || ''`)
      return typeof text === 'string' && text.includes(EC09_LENS_MODEL_TOKEN)
    }, 'Lens durable history rendering', 20_000, 150)
    const historyPath = join(screenshotDir, 'history.png')
    await webdriver.screenshot(historyPath)
    report.states.push('history')
    report.screenshots.push({ state: 'history', path: 'history.png' })

    report.assertions.push('request-material-matches-authorization', 'session-transcript-observed')
    report.contextAuthorization = {
      requestedScope: 'section',
      authorizedScope: 'section',
      actualScope: 'section',
      materialScope: 'section',
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      previewMatchesMaterial: target.previewObserved === true,
      requestMaterialFrozen: materialFrozen,
    }
    report.sessionEvidence = {
      requestId,
      transcriptSource: 'dsh-session',
      transcriptObserved: true,
      requestMaterialObserved: target.previewObserved === true,
      transcriptContainsAuthorizedContext: history.user.text.includes(EC09_LENS_SECTION),
      materialSnapshotId: snapshot.id,
      materialRevision: snapshot.revision,
    }
    report.diagnostics = {
      ...report.diagnostics,
      reason: 'real Chromium selection -> native host -> Harness -> Tauri WebView2 explicit section authorization -> Session -> model -> history',
      extensionId: browser.extensionId,
      previewSha256: sha256(preview),
      modelRequests: gate.requests,
      newerGlobalExcluded: target.forbidden?.[EC09_LENS_NEWER_GLOBAL] === false,
    }
    report.status = 'PASS'
  } catch (error) {
    report.status = 'FAIL'
    report.diagnostics.reason = error instanceof Error ? error.message : String(error)
    const dshOutput = dsh?.output()
    const driverOutput = tauriDriver?.output()
    const applicationOutput = tauriApplication?.output()
    if (dshOutput !== undefined) report.diagnostics.dshStderr = redactOutput(dshOutput.stderr).trim().slice(-8_000)
    if (driverOutput !== undefined) report.diagnostics.tauriDriverStderr = redactOutput(driverOutput.stderr).trim().slice(-8_000)
    if (applicationOutput !== undefined) report.diagnostics.tauriApplicationStderr = redactOutput(applicationOutput.stderr).trim().slice(-8_000)
  } finally {
    report.diagnostics.modelRequests = gate?.requests ?? report.diagnostics.modelRequests
    await webdriver.close().catch(() => undefined)
    tauriDriver?.stop()
    tauriApplication?.stop()
    if (browser?.context !== undefined) await browser.context.close().catch(() => undefined)
    if (nativeHostRegistered) await unregisterNativeHost(env).catch(() => undefined)
    pipeClient?.close()
    dsh?.stop()
    await gate?.close().catch(() => undefined)
    await fixture?.close().catch(() => undefined)
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    if (env.EC09_KEEP_RUN_ROOT !== '1') await removeOwnedPath(dirs.root, dirs.root).catch(() => undefined)
  }
  return report
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runEc09TauriLensDriver()
  console.log(JSON.stringify({ status: report.status, reason: report.diagnostics.reason, report: process.env.DSH_LENS_REPORT_PATH ?? null }))
  process.exitCode = report.status === 'PASS' ? 0 : 1
}
