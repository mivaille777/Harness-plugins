import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

async function versionFrom(path: string, pattern: RegExp): Promise<number> {
  const source = await readFile(path, 'utf8')
  const match = source.match(pattern)
  if (match?.[1] === undefined) throw new Error(`protocol version declaration not found in ${path}`)
  return Number(match[1])
}

describe('browser native messaging protocol', () => {
  it('stays aligned with TypeScript and Rust Protocol V4', async () => {
    const browser = await versionFrom(
      resolve(here, '../../src/background.ts'),
      /const PROTOCOL_VERSION = (\d+)/,
    )
    const typescript = await versionFrom(
      resolve(here, '../../../src/bridge/protocol.ts'),
      /IPC_PROTOCOL_VERSION = (\d+) as const/,
    )
    const rust = await versionFrom(
      resolve(here, '../../../native/src-tauri/src/protocol.rs'),
      /IPC_PROTOCOL_VERSION: u32 = (\d+);/,
    )

    expect(browser).toBe(4)
    expect(browser).toBe(typescript)
    expect(browser).toBe(rust)
  })
})
