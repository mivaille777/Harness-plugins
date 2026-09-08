import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

export const EXIT_CODES = Object.freeze({
  PASS: 0,
  FAIL: 1,
  NOT_RUN: 2,
})

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_CAPTURED_OUTPUT_BYTES = 256 * 1024

/** Return the process exit code for an observed status. */
export function exitCodeForStatus(status) {
  if (status === 'PASS') return EXIT_CODES.PASS
  if (status === 'NOT RUN') return EXIT_CODES.NOT_RUN
  return EXIT_CODES.FAIL
}

/** Keep a cleanup target inside the run-owned root. */
export function isOwnedPath(root, target) {
  const rootPath = resolve(root)
  const targetPath = resolve(target)
  const suffix = relative(rootPath, targetPath)
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix))
}

/** Remove secret-looking values from diagnostics before they are persisted. */
export function redactOutput(value) {
  return String(value)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,}]+/gi, '$1[redacted]')
    .replace(/(DEEPSEEK_API_KEY\s*[=:]\s*)[^\s,}]+/g, '$1[redacted]')
}

/** Capture a bounded child-process result with a hard timeout. */
export async function runProcess(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    shell = false,
  } = options
  return await new Promise(resolveResult => {
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolveResult({ code: null, signal: null, timedOut: false, error: String(error), stdout: '', stderr: '' })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const append = (current, chunk) => {
      const next = current + chunk.toString()
      return next.length > MAX_CAPTURED_OUTPUT_BYTES
        ? next.slice(next.length - MAX_CAPTURED_OUTPUT_BYTES)
        : next
    }
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined && process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        killer.once('error', () => undefined)
      } else {
        child.kill('SIGTERM')
      }
    }, timeoutMs)
    const finish = (code, signal, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        code: typeof code === 'number' ? code : null,
        signal: signal ?? null,
        timedOut,
        error: error === undefined ? null : String(error),
        stdout,
        stderr,
      })
    }
    child.once('error', error => finish(null, null, error))
    child.once('close', (code, signal) => finish(code, signal))
  })
}

/** Start a deterministic OpenAI-compatible SSE endpoint for the keyless L1 run. */
export async function startLocalModelServer() {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      try {
        requests.push({
          method: request.method,
          url: request.url,
          model: JSON.parse(body).model,
        })
      } catch {
        requests.push({ method: request.method, url: request.url, model: null })
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'close',
      })
      response.end([
        'data: {"id":"r07-local","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
        'data: {"id":"r07-local","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"R07_SESSION_OK"}}]}',
        'data: {"id":"r07-local","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
        'data: [DONE]',
        '',
      ].join('\n\n'))
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await closeServer(server)
    throw new Error('local model server did not expose a TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  }
}

/** Create a temporary directory owned by this run. */
export async function createRunDirectories(prefix = 'dsh-selection-companion-r07-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const home = join(root, 'dsh-home')
  const workspace = join(root, 'workspace')
  const artifacts = join(root, 'artifacts')
  await Promise.all([mkdir(home, { recursive: true }), mkdir(workspace, { recursive: true }), mkdir(artifacts, { recursive: true })])
  return { root, home, workspace, artifacts }
}

/** Locate the supported dsh launcher without printing a credential-bearing environment. */
export function dshCommand() {
  return process.platform === 'win32'
    ? { command: process.env.ComSpec ?? 'cmd.exe', shell: false }
    : { command: 'dsh', shell: false }
}

/** Build a bounded command line for the Windows launcher without shell interpolation. */
export function dshArgs(args) {
  if (process.platform !== 'win32') return args
  const quote = value => /[\s"&|<>^]/.test(value)
    ? `"${value.replaceAll('"', '\\"')}"`
    : value
  return ['/d', '/s', '/c', ['dsh.cmd', ...args].map(quote).join(' ')]
}

/** Build a command invocation through cmd.exe when a Windows shim is required. */
export function packageManagerInvocation(args) {
  if (process.platform !== 'win32') return { command: 'pnpm', args, shell: false }
  const quote = value => /[\s"&|<>^]/.test(value)
    ? `"${value.replaceAll('"', '\\"')}"`
    : value
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', ['pnpm.cmd', ...args].map(quote).join(' ')],
    shell: false,
  }
}

/** Find durable session files below one isolated DSH_HOME. */
export async function findSessionFiles(root) {
  const found = []
  async function walk(directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async entry => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return walk(path)
      if (!entry.isFile() || !/\.(jsonl|zstd|jsonl\.zst|jsonl\.zstd)$/i.test(entry.name)) return
      const info = await stat(path)
      if (info.size > 0) found.push({ path, bytes: info.size })
    }))
  }
  await walk(root)
  return found
}

/** Write a report beneath the caller-selected artifact root. */
export async function writeReport(artifactDirectory, report, fileName = 'r07-session-e2e.json') {
  await mkdir(artifactDirectory, { recursive: true })
  const path = join(artifactDirectory, fileName)
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return path
}

/** Run one dsh profile task in an isolated profile and record only safe facts. */
export async function runProfileTask({ home, workspace, repoRoot, modelServer, real = false }) {
  const launcher = dshCommand()
  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_SELECTION_COMPANION_DISABLE_BRIDGE: '1',
    DSH_TELEMETRY_DISABLED: '1',
    DSH_PERMISSION_MODE: 'danger-full-access',
  }
  if (!real) {
    env.DEEPSEEK_API_KEY = 'r07-local-smoke-key'
    env.DEEPSEEK_BASE_URL = modelServer.url
  }
  const installArgs = ['plugin', '--profile', 'headless', 'add', `file:${repoRoot.replaceAll('\\', '/')}`]
  const install = await runProcess(
    launcher.command,
    dshArgs(installArgs),
    { cwd: workspace, env, timeoutMs: 180_000, shell: launcher.shell },
  )
  if (install.code !== 0) {
    return { status: 'FAIL', reason: 'plugin install failed', install, run: null, sessionFiles: [] }
  }
  const profileManifest = join(home, 'profiles', 'headless', 'package.json')
  const profileText = await readFile(profileManifest, 'utf8').catch(() => '')
  let profilePackage = null
  try { profilePackage = JSON.parse(profileText) } catch { profilePackage = null }
  const bundles = profilePackage?.dsh?.profile?.bundles
  const pluginComposed = Array.isArray(bundles) && bundles.includes('dsh-selection-companion')
  const runArgs = ['--profile', 'headless', real ? 'R07 real profile smoke: respond with a concise answer.' : 'R07 keyless profile smoke: respond with the fixed local token.']
  const run = await runProcess(
    launcher.command,
    dshArgs(runArgs),
    { cwd: workspace, env, timeoutMs: 180_000, shell: launcher.shell },
  )
  const combined = `${run.stdout}\n${run.stderr}`
  const sessionFiles = await findSessionFiles(home)
  const output = redactOutput(run.stdout).trim()
  const localTokenObserved = combined.includes('R07_SESSION_OK')
  const pluginLoaded = /\[selection-companion\] plugin loaded!/.test(combined)
  const status = run.code === 0 && sessionFiles.length > 0 && pluginComposed && pluginLoaded && output.length > 0 && (real || localTokenObserved)
    ? 'PASS'
    : 'FAIL'
  return {
    status,
    reason: status === 'PASS' ? 'profile boot, plugin composition, task output, and durable session file observed' : 'profile smoke assertion failed',
    install: { code: install.code, stderr: redactOutput(install.stderr).trim() },
    run: {
      code: run.code,
      signal: run.signal,
      timedOut: run.timedOut,
      stdout: output,
      stderr: redactOutput(run.stderr).trim(),
      pluginLoaded,
      localTokenObserved,
    },
    sessionFiles,
    pluginComposed,
  }
}

/** Confirm the basic tools needed by the selected R07 layer. */
export async function preflight(env = process.env) {
  const launcher = dshCommand()
  const commandEnv = { ...env }
  const packageManager = packageManagerInvocation(['--version'])
  const [node, pnpm, dsh] = await Promise.all([
    runProcess(process.execPath, ['--version'], { env: commandEnv, timeoutMs: 10_000 }),
    runProcess(packageManager.command, packageManager.args, { env: commandEnv, timeoutMs: 10_000, shell: packageManager.shell }),
    runProcess(launcher.command, dshArgs(['--version']), { env: commandEnv, timeoutMs: 20_000, shell: launcher.shell }),
  ])
  return {
    platform: process.platform,
    node: node.code === 0 ? node.stdout.trim() : null,
    pnpm: pnpm.code === 0 ? pnpm.stdout.trim() : null,
    dsh: dsh.code === 0 ? dsh.stdout.trim() : null,
    windows: process.platform === 'win32',
    apiKeyPresent: typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.length > 0,
    failures: [
      process.platform !== 'win32' ? 'Windows is required for the supported native-pipe path' : null,
      node.code !== 0 ? 'Node is unavailable' : null,
      pnpm.code !== 0 ? 'pnpm is unavailable' : null,
      dsh.code !== 0 ? 'dsh is unavailable' : null,
    ].filter(Boolean),
  }
}

export async function closeServer(server) {
  if (!server.listening) return
  await new Promise(resolveClose => server.close(() => resolveClose()))
}

/** Safely remove only a run-owned directory. */
export async function removeOwnedPath(root, target) {
  if (!isOwnedPath(root, target)) throw new Error(`refusing to remove path outside run root: ${target}`)
  const fs = await import('node:fs/promises')
  await fs.rm(target, { recursive: true, force: true })
}
