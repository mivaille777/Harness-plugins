import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8'),
) as {
  manifest_version: number
  permissions?: string[]
  host_permissions?: string[]
  background?: { service_worker?: string }
  content_scripts?: Array<{ all_frames?: boolean }>
}

describe('browser extension manifest', () => {
  it('uses MV3 Native Messaging rather than a localhost HTTP bridge', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toContain('nativeMessaging')
    expect(manifest.background?.service_worker).toBe('background.js')
    expect(manifest.content_scripts?.[0]?.all_frames).toBe(true)

    const hosts = manifest.host_permissions ?? []
    expect(hosts.some(host => host.includes('127.0.0.1') || host.includes('localhost'))).toBe(false)
  })
})
