import process from 'node:process'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'

if (process.platform !== 'win32') {
  console.error('SKIP: test:bridge:integration requires Windows named pipes.')
  process.exit(2)
}

const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error('pnpm did not provide npm_execpath')
const build = spawnSync(process.execPath, [pnpmCli, 'build'], { cwd: process.cwd(), stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const {
  BridgeMessageRouter,
  SelectionCompanionBridgeService,
  SelectionContextService,
} = await import('../lib/index.js')

const endpoint = String.raw`\\.\pipe\dsh-selection-companion-integration-${process.pid}-${Date.now()}`
const context = new Context()
new SelectionContextService(context)
const listeners = new Set()
let disposed = 0
let submitted = 0
const sessions = {
  async list() { return [] },
  async create() { return 'session-integration' },
  async submit() {
    submitted += 1
    return { requestId: 'request-integration', messageId: 'message-integration', delivery: 'queued', duplicate: false }
  },
  cancel() { return true },
  async subscribe(_sessionId, _cursor, listener) {
    listeners.add(listener)
    for (let cursor = 1; cursor <= 100; cursor += 1) {
      listener({ cursor, persistent: true, kind: 'status', data: { status: 'running', cursor } })
    }
    return {
      dispose() {
        disposed += 1
        listeners.delete(listener)
      },
    }
  },
}
const bridge = new SelectionCompanionBridgeService(context, {
  endpoint,
  idleTimeoutMs: 5_000,
  maxClients: 4,
})
bridge.router = new BridgeMessageRouter(context.selectionContext, sessions)
const server = createServer(bridge.accept.bind(bridge))

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(endpoint, resolve)
})

const child = spawn('cargo.exe', [
  'run',
  '--quiet',
  '--manifest-path', 'native/src-tauri/Cargo.toml',
  '--bin', 'dsh-selection-companion-bridge-probe',
], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_SELECTION_COMPANION_INTEGRATION_PIPE: endpoint },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
let exit
const timeout = setTimeout(() => child.kill(), 60_000)
try {
  exit = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  for (let attempt = 0; attempt < 100 && bridge.status().clients !== 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }

  if (stdout.trim()) console.log(stdout.trim())
  if (stderr.trim()) console.error(stderr.trim())
  if (exit.signal !== null) throw new Error(`Rust bridge probe ended by signal ${exit.signal}`)
  if (exit.code !== 0) throw new Error(`Rust bridge probe exited ${exit.code}`)
  if (submitted !== 1) throw new Error(`expected one submitted request, received ${submitted}`)
  if (disposed !== 1 || listeners.size !== 0) {
    throw new Error(`subscription cleanup failed: disposed=${disposed}, listeners=${listeners.size}`)
  }
  if (bridge.status().clients !== 0) throw new Error(`bridge retained ${bridge.status().clients} clients`)
  console.log('PASS: Node/Rust named-pipe clients and subscription listener returned to zero')
} finally {
  clearTimeout(timeout)
  if (exit === undefined) child.kill()
  await bridge.stop()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
