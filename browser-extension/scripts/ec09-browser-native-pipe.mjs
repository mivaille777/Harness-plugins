import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEc08PipeClient,
  EC08_PROTOCOL,
  startEc08ModelGate,
} from '../../scripts/ec08-session-model-boundary.mjs'
import {
  createRunDirectories,
  dshInvocation,
  preflight,
  redactOutput,
  removeOwnedPath,
  runProcess,
  writeReport,
} from '../../scripts/r07-runner.mjs'

export const EC09_BROWSER_SELECTION_SENTINEL = 'EC09_BROWSER_SELECTED_TOKEN_57721'
export const EC09_BROWSER_SECTION_SENTINEL = 'EC09_BROWSER_SECTION_CONTEXT_60209'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const extensionRoot = resolve(here, '..')
const MAX_OUTPUT_BYTES = 128 * 1024

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
  throw new Error(`EC-09 browser runner could not connect to ${endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function timeoutPromise(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms))
}

async function startFixtureServer() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>EC09 Browser Fixture</title>
<style>body{font:18px sans-serif;padding:40px}#target{white-space:nowrap}</style></head>
<body><main><section id="scope"><h2>EC09 Context Section</h2>
<p id="target">Before selection ${EC09_BROWSER_SELECTION_SENTINEL} after selection.</p>
<p>${EC09_BROWSER_SECTION_SENTINEL}</p></section></main></body></html>`
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(html)
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('EC-09 fixture server did not expose a TCP port')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: async () => {
      if (server.listening) await new Promise(resolveClose => server.close(() => resolveClose()))
    },
  }
}

async function currentBrowserSnapshot(client, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const current = await client.request('selection.current', {})
    last = current.payload?.snapshot ?? null
    const selected = last?.selection?.text
    if (typeof selected === 'string' && selected.includes(EC09_BROWSER_SELECTION_SENTINEL)) return last
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150))
  }
  throw new Error(`EC-09 browser selection did not reach Harness; last snapshot=${last?.id ?? 'none'}`)
}

async function registerNativeHost(extensionId, binaryPath, env) {
  return await runProcess('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', join(repoRoot, 'scripts', 'register-native-host.ps1'),
    '-ExtensionId', extensionId,
    '-BinaryPath', binaryPath,
    '-Browser', 'Chrome',
  ], { cwd: repoRoot, env, timeoutMs: 20_000 })
}

async function unregisterNativeHost(env) {
  return await runProcess('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', join(repoRoot, 'scripts', 'unregister-native-host.ps1'),
    '-Browser', 'Chrome',
  ], { cwd: repoRoot, env, timeoutMs: 20_000 })
}

export async function runEc09BrowserNativePipe(env = process.env) {
  const dirs = await createRunDirectories('dsh-selection-companion-ec09-browser-')
  const artifactRoot = env.EC09_BROWSER_ARTIFACT_ROOT === undefined
    ? join(dirs.root, 'artifacts')
    : resolve(env.EC09_BROWSER_ARTIFACT_ROOT)
  await mkdir(artifactRoot, { recursive: true })
  const reportPath = join(artifactRoot, 'ec09-browser-native-pipe.json')
  const screenshotPath = join(artifactRoot, 'browser-selection.png')
  const endpoint = env.EC09_PIPE ?? String.raw`\\.\pipe\dsh-selection-companion-ec09-browser-${process.pid}-${Date.now()}`
  const nativeHost = resolve(env.EC09_NATIVE_HOST ?? join(repoRoot, 'native', 'src-tauri', 'target', 'debug', 'dsh-selection-companion-host.exe'))
  const extensionDist = resolve(env.EC09_EXTENSION_DIST ?? join(extensionRoot, 'dist'))

  const report = {
    schemaVersion: 1,
    layer: 'EC09-browser-native-pipe',
    status: 'NOT RUN',
    reason: null,
    preflight: null,
    browser: { engine: 'playwright-chromium', realDomSelection: false, extensionLoaded: false, extensionId: null },
    nativeHost: { binaryPresent: existsSync(nativeHost), registered: false },
    bridge: { bootstrapHeld: false, hello: false, selectionObserved: false },
    selection: null,
    artifacts: { report: reportPath, screenshot: screenshotPath },
  }

  let gate
  let fixture
  let dsh
  let context
  let pipeClient
  let hostRegistered = false
  try {
    const host = await preflight(env)
    report.preflight = host
    if (host.failures.length > 0) {
      report.reason = host.failures.join('; ')
      return report
    }
    if (!report.nativeHost.binaryPresent) throw new Error(`native messaging host binary is missing: ${nativeHost}`)
    if (!existsSync(join(extensionDist, 'manifest.json'))) throw new Error(`browser extension dist is missing: ${extensionDist}`)

    gate = await startEc08ModelGate()
    fixture = await startFixtureServer()
    const runEnv = {
      ...env,
      DSH_HOME: dirs.home,
      DSH_SELECTION_COMPANION_PIPE: endpoint,
      DSH_TELEMETRY_DISABLED: '1',
      DSH_PERMISSION_MODE: 'danger-full-access',
      DEEPSEEK_API_KEY: 'ec09-local-smoke-key',
      DEEPSEEK_BASE_URL: gate.url,
    }
    delete runEnv.DSH_SELECTION_COMPANION_DISABLE_BRIDGE

    const installInvocation = dshInvocation(
      ['plugin', '--profile', 'headless', 'add', `file:${repoRoot.replaceAll('\\', '/')}`],
      runEnv,
    )
    const install = await runProcess(installInvocation.command, installInvocation.args, {
      cwd: dirs.workspace,
      env: runEnv,
      timeoutMs: 180_000,
      shell: installInvocation.shell,
      windowsVerbatimArguments: installInvocation.windowsVerbatimArguments,
    })
    if (install.code !== 0) throw new Error(`plugin install failed: ${redactOutput(install.stderr).trim()}`)

    const invocation = dshInvocation(
      ['--profile', 'headless', 'EC09 browser bootstrap request. Wait for the deterministic local model.'],
      runEnv,
    )
    dsh = spawnDsh(invocation, { cwd: dirs.workspace, env: runEnv })
    await Promise.race([gate.bootstrapStarted, timeoutPromise(30_000, 'EC-09 browser bootstrap model request')])
    report.bridge.bootstrapHeld = true

    const socket = await connectPipe(endpoint)
    pipeClient = createEc08PipeClient(socket)
    const hello = await pipeClient.request('bridge.hello', {
      client: { name: 'ec09-browser-runner', version: '1.0.0', platform: 'windows' },
      supportedProtocols: [EC08_PROTOCOL],
    })
    report.bridge.hello = hello.type === 'bridge.hello.result' && hello.payload?.protocol === EC08_PROTOCOL
    if (!report.bridge.hello) throw new Error('EC-09 browser runner did not negotiate Protocol V4')

    context = await chromium.launchPersistentContext(join(dirs.root, 'chromium-profile'), {
      channel: 'chromium',
      headless: true,
      env: { ...env, DSH_SELECTION_COMPANION_PIPE: endpoint },
      args: [
        `--disable-extensions-except=${extensionDist}`,
        `--load-extension=${extensionDist}`,
      ],
    })
    let worker = context.serviceWorkers()[0]
    if (worker === undefined) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 })
    const extensionId = worker.url().split('/')[2]
    if (extensionId === undefined || !/^[a-p]{32}$/.test(extensionId)) throw new Error(`unexpected extension id: ${extensionId ?? 'missing'}`)
    report.browser.extensionLoaded = true
    report.browser.extensionId = extensionId

    const registration = await registerNativeHost(extensionId, nativeHost, runEnv)
    if (registration.code !== 0) throw new Error(`native host registration failed: ${redactOutput(registration.stderr).trim()}`)
    hostRegistered = true
    report.nativeHost.registered = true

    const page = await context.newPage()
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#target')
    await page.waitForTimeout(300)
    await page.evaluate(token => {
      const target = document.querySelector('#target')
      if (target === null || target.firstChild === null) throw new Error('fixture target text is missing')
      const text = target.firstChild
      const source = text.textContent ?? ''
      const start = source.indexOf(token)
      if (start < 0) throw new Error('selection sentinel is missing from fixture')
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + token.length)
      const selection = window.getSelection()
      if (selection === null) throw new Error('window selection is unavailable')
      selection.removeAllRanges()
      selection.addRange(range)
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
    }, EC09_BROWSER_SELECTION_SENTINEL)
    report.browser.realDomSelection = true

    const snapshot = await currentBrowserSnapshot(pipeClient)
    const sectionText = snapshot?.context?.sectionText ?? ''
    report.bridge.selectionObserved = true
    report.selection = {
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      provider: snapshot.provider,
      sourceKind: snapshot.source?.kind ?? null,
      selectedSentinelObserved: snapshot.selection?.text?.includes(EC09_BROWSER_SELECTION_SENTINEL) === true,
      sectionSentinelObserved: typeof sectionText === 'string' && sectionText.includes(EC09_BROWSER_SECTION_SENTINEL),
      localContextAvailable: snapshot.capabilities?.localContext === true,
      sectionContextAvailable: snapshot.capabilities?.sectionContext === true,
    }
    await page.screenshot({ path: screenshotPath, fullPage: true })

    const pass = report.browser.extensionLoaded
      && report.browser.realDomSelection
      && report.nativeHost.registered
      && report.bridge.hello
      && report.bridge.selectionObserved
      && report.selection.selectedSentinelObserved
      && report.selection.sectionSentinelObserved
      && report.selection.sourceKind === 'browser'
      && report.selection.provider === 'browser-dom'
    report.status = pass ? 'PASS' : 'FAIL'
    report.reason = pass
      ? 'real Chromium DOM selection traversed extension -> native messaging host -> Protocol V4 pipe -> Harness selection.current'
      : 'real browser/native-pipe assertions were incomplete'
    return report
  } catch (error) {
    report.status = 'FAIL'
    report.reason = error instanceof Error ? error.message : String(error)
    const output = dsh?.output()
    if (output !== undefined) {
      report.process = {
        stdout: redactOutput(output.stdout).trim().slice(-8_000),
        stderr: redactOutput(output.stderr).trim().slice(-8_000),
      }
    }
    return report
  } finally {
    if (context !== undefined) await context.close().catch(() => undefined)
    if (hostRegistered) await unregisterNativeHost(env).catch(() => undefined)
    pipeClient?.close()
    dsh?.stop()
    gate?.releaseBootstrap()
    await gate?.close().catch(() => undefined)
    await fixture?.close().catch(() => undefined)
    await writeReport(artifactRoot, report, 'ec09-browser-native-pipe.json')
    if (env.EC09_KEEP_RUN_ROOT !== '1') await removeOwnedPath(dirs.root, dirs.root).catch(() => undefined)
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runEc09BrowserNativePipe()
  console.log(JSON.stringify({ status: report.status, reason: report.reason, report: report.artifacts.report }))
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'NOT RUN' ? 2 : 1
}
