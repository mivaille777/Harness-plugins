import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { once } from 'node:events'

const endpoint = process.env.DSH_SELECTION_COMPANION_PIPE
  ?? String.raw`\\.\pipe\dsh-selection-companion-v1`
const socket = createConnection(endpoint)
const pending = []
let buffer = Buffer.alloc(0)

socket.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (buffer.length >= 4) {
    const length = buffer.readUInt32BE(0)
    if (buffer.length < 4 + length) return
    const payload = buffer.subarray(4, 4 + length)
    buffer = buffer.subarray(4 + length)
    const message = JSON.parse(payload.toString('utf8'))
    pending.shift()?.resolve(message)
  }
})
socket.on('error', error => {
  while (pending.length) pending.shift()?.reject(error)
})

function encode(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, payload])
}

function nextMessage(timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const item = { resolve, reject }
    const timer = setTimeout(() => {
      const index = pending.indexOf(item)
      if (index >= 0) pending.splice(index, 1)
      reject(new Error(`timed out waiting for Harness bridge response after ${timeoutMs} ms`))
    }, timeoutMs)
    item.resolve = value => {
      clearTimeout(timer)
      resolve(value)
    }
    item.reject = error => {
      clearTimeout(timer)
      reject(error)
    }
    pending.push(item)
  })
}

async function request(type, payload) {
  const id = `debug-${randomUUID()}`
  const responsePromise = nextMessage()
  socket.write(encode({ protocol: 1, id, type, payload }))
  const response = await responsePromise
  if (response.id !== id) throw new Error(`response id mismatch: ${response.id}`)
  if (response.type === 'error.response') {
    throw new Error(`${response.payload.code}: ${response.payload.message}`)
  }
  return response
}

try {
  await once(socket, 'connect')
  await request('bridge.hello', {
    client: { name: 'selection-debugger', version: '0.1.0', platform: 'windows' },
    supportedProtocols: [1],
  })
  const response = await request('selection.current', {})
  const snapshot = response.payload.snapshot
  if (snapshot === null) {
    console.log('[debug-selection] no current selection')
  } else {
    console.log(JSON.stringify(snapshot, null, 2))
  }
} finally {
  socket.end()
}
