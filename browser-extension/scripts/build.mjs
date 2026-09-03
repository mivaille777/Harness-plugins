import { build } from 'esbuild'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const dist = resolve(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

await build({
  entryPoints: {
    content: resolve(root, 'src/content.ts'),
    background: resolve(root, 'src/background.ts'),
  },
  bundle: true,
  outdir: dist,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: true,
  logLevel: 'info',
})

await copyFile(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'))
console.log(`[browser-extension] built ${dist}`)
