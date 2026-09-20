import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { readdir, readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const PROTOCOL = 4
const DEFAULT_PIPE = String.raw`\\.\pipe\dsh-selection-companion-v4`
const endpoint = process.env.DSH_SELECTION_COMPANION_PIPE?.trim() || DEFAULT_PIPE
const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const failures = []
const warnings = []

function runDsh(args) {
  const result = spawnSync('dsh', args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: process.platform === 'win32',
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

function pass(label, detail = '') {
  console.log('[PASS] ' + label + (detail ? ': ' + detail : ''))
}

function fail(label, detail = '') {
  failures.push({ label, detail })
  console.error('[FAIL] ' + label + (detail ? ': ' + detail : ''))
}

function warn(label, detail = '') {
  warnings.push({ label, detail })
  console.warn('[WARN] ' + label + (detail ? ': ' + detail : ''))
}

function encode(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, payload])
}

function frameReader(socket) {
  let buffer = Buffer.alloc(0)
  const queue = []
  const waiters = []

  const flush = () => {
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)
      if (buffer.length < 4 + length) return
      const payload = buffer.subarray(4, 4 + length)
      buffer = buffer.subarray(4 + length)
      const value = JSON.parse(payload.toString('utf8'))
      const waiter = waiters.shift()
      if (waiter) waiter.resolve(value)
      else queue.push(value)
    }
  }

  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    flush()
  })
  socket.on('error', error => {
    while (waiters.length) waiters.shift()?.reject(error)
  })

  return (timeoutMs = 2500) => {
    const queued = queue.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject }
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new Error('timed out after ' + timeoutMs + ' ms'))
      }, timeoutMs)
      waiter.resolve = value => {
        clearTimeout(timer)
        resolve(value)
      }
      waiter.reject = error => {
        clearTimeout(timer)
        reject(error)
      }
      waiters.push(waiter)
    })
  }
}

async function request(socket, next, type, payload) {
  const id = 'diagnose-' + randomUUID()
  socket.write(encode({ protocol: PROTOCOL, id, type, payload }))
  const response = await next()
  if (response.id !== id) throw new Error('response id mismatch: expected ' + id + ', received ' + String(response.id))
  if (response.type === 'error.response') {
    throw new Error((response.payload?.code ?? 'BRIDGE_ERROR') + ': ' + (response.payload?.message ?? 'unknown bridge error'))
  }
  return response
}

async function checkPipe() {
  const socket = createConnection(endpoint)
  socket.setTimeout(2500)
  try {
    await Promise.race([
      once(socket, 'connect'),
      once(socket, 'error').then(([error]) => { throw error }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 2500)),
    ])
    pass('Named pipe reachable', endpoint)

    const next = frameReader(socket)
    const hello = await request(socket, next, 'bridge.hello', {
      client: { name: 'selection-diagnostics', version: '0.1.0', platform: 'windows' },
      supportedProtocols: [PROTOCOL],
    })
    if (hello.type !== 'bridge.hello.result') throw new Error('unexpected hello response ' + hello.type)
    if (hello.payload?.protocol !== PROTOCOL) throw new Error('protocol mismatch: ' + String(hello.payload?.protocol))
    pass('Protocol V4 handshake', (hello.payload.server?.name ?? 'unknown') + '@' + (hello.payload.server?.version ?? 'unknown'))

    const sentAt = Date.now()
    const pong = await request(socket, next, 'bridge.ping', { sentAt })
    if (pong.type !== 'bridge.pong') throw new Error('unexpected ping response ' + pong.type)
    pass('Bridge ping', Math.max(0, Date.now() - sentAt) + ' ms')

    const sessions = await request(socket, next, 'session.list', {})
    if (sessions.type !== 'session.list.result') throw new Error('unexpected session response ' + sessions.type)
    pass('Harness Session service reachable', sessions.payload.sessions.length + ' session(s)')

    const selection = await request(socket, next, 'selection.current', {})
    if (selection.type !== 'selection.current.result') throw new Error('unexpected selection response ' + selection.type)
    pass(
      'Selection Context service reachable',
      selection.payload.snapshot === null ? 'no current snapshot' : 'snapshot ' + selection.payload.snapshot.id,
    )
  } finally {
    socket.end()
  }
}

async function recentHarnessLogHints() {
  const logsDir = join(dshHome, 'logs')
  let names
  try {
    names = await readdir(logsDir)
  } catch {
    return
  }

  const candidates = []
  for (const name of names) {
    if (!name.endsWith('.log')) continue
    const path = join(logsDir, name)
    try {
      const info = await stat(path)
      candidates.push({ path, name, mtimeMs: info.mtimeMs })
    } catch {}
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const file of candidates.slice(0, 5)) {
    let content
    try {
      content = await readFile(file.path, 'utf8')
    } catch {
      continue
    }
    const lines = content.split(/\r?\n/).filter(line =>
      /selection-context|selection-sessions|selection-bridge|selection companion|dsh-selection-companion/i.test(line)
    )
    if (lines.length > 0) {
      console.log('\n[INFO] Recent Harness log hints from ' + file.name)
      for (const line of lines.slice(-30)) console.log('  ' + line)
      return
    }
  }
}

console.log('DeepSeek Harness Selection Companion diagnostics')
console.log('DSH_HOME: ' + dshHome)
console.log('Pipe: ' + endpoint)
console.log('')

const version = runDsh(['--version'])
if (!version.ok) {
  fail('dsh CLI available', version.error?.message || version.stderr.trim() || 'exit ' + String(version.status))
} else {
  pass('dsh CLI available', version.stdout.trim())
  if (!version.stdout.includes('0.1.1-rc.2')) {
    warn('Harness compatibility', 'tested against 0.1.1-rc.2; detected ' + version.stdout.trim())
  } else {
    pass('Harness compatibility', '0.1.1-rc.2')
  }
}

const installed = runDsh(['plugin', '--profile', 'web', 'list', 'dsh-selection-companion', '--depth', '0'])
if (installed.ok && /dsh-selection-companion@/.test(installed.stdout)) {
  pass('Plugin installed in web profile')
} else {
  fail('Plugin installed in web profile', installed.stderr.trim() || installed.stdout.trim() || 'package not listed')
}

const config = runDsh(['--profile', 'web', '--dump-config'])
if (!config.ok) {
  fail('web profile composition readable', config.stderr.trim() || 'exit ' + String(config.status))
} else {
  pass('web profile composition readable')
  const expected = [
    ['selection-context', 'dsh-selection-companion/context'],
    ['selection-sessions', 'dsh-selection-companion/session'],
    ['selection-bridge', 'dsh-selection-companion/bridge'],
  ]
  for (const [id, name] of expected) {
    const idFound = config.stdout.includes('- id: ' + id)
    const nameFound = config.stdout.includes('name: ' + name)
    if (idFound && nameFound) pass('Cordis Loader entry ' + id, name)
    else fail('Cordis Loader entry ' + id, 'expected ' + name)
  }
}

if (process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE === '1') {
  fail('Bridge enabled', 'DSH_SELECTION_COMPANION_DISABLE_BRIDGE=1')
} else {
  pass('Bridge enabled')
}
if (process.env.DSH_SELECTION_COMPANION_PIPE?.trim()) {
  warn('Custom pipe override', process.env.DSH_SELECTION_COMPANION_PIPE.trim())
}

try {
  await checkPipe()
} catch (error) {
  fail('Harness runtime bridge ready', error instanceof Error ? error.message : String(error))
  console.error('       Start "dsh web" in another terminal and rerun this command.')
}

await recentHarnessLogHints()

console.log('')
if (failures.length === 0) {
  console.log('[READY] Selection Companion Harness runtime is healthy.')
} else {
  console.error('[NOT READY] ' + failures.length + ' diagnostic check(s) failed.')
  process.exitCode = 1
}
