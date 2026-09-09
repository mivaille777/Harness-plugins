import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = path.join(root, 'native', 'src', 'styles.css')
const evidenceDir = path.join(root, 'docs', 'evidence')
const screenshotNames = ['r08-ui-tauri-zh-dark-narrow.png', 'r08-ui-tauri-zh-dark-wide.png']
const expectedScreenshotSizes = {
  'r08-ui-tauri-zh-dark-narrow.png': { width: 390, height: 430 },
  'r08-ui-tauri-zh-dark-wide.png': { width: 900, height: 1700 },
}

function pngSize(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

export async function inspectVisualContract() {
  const css = await readFile(cssPath, 'utf8')
  const requiredRules = [
    '@media (prefers-color-scheme: dark)',
    '@media (prefers-reduced-motion: reduce)',
    '@media (forced-colors: active)',
    '@media (max-width: 420px)',
    '.lens {',
    'overflow-x: hidden;',
    '.answer.answer-live',
  ]
  const missingRules = requiredRules.filter(rule => !css.includes(rule))
  const screenshots = {}
  const failures = []
  for (const name of screenshotNames) {
    const filePath = path.join(evidenceDir, name)
    const bytes = await readFile(filePath).catch(() => null)
    const size = bytes === null ? null : pngSize(bytes)
    screenshots[name] = size === null ? null : { ...size, bytes: bytes.length }
    if (size === null || bytes.length === 0) failures.push(`invalid or missing screenshot: ${name}`)
    const expected = expectedScreenshotSizes[name]
    if (size !== null && expected !== undefined && (size.width !== expected.width || size.height !== expected.height)) {
      failures.push(`screenshot has unexpected dimensions: ${name} (${size.width}x${size.height})`)
    }
  }
  if (missingRules.length > 0) failures.push(`missing responsive/accessibility CSS rules: ${missingRules.join(', ')}`)
  const noticeRule = css.match(/\.notice\s*\{([^}]*)\}/s)?.[1] ?? ''
  if (!noticeRule.includes('overflow-wrap: anywhere;')) failures.push('notice text must wrap long untrusted status content')
  const narrowStart = css.indexOf('@media (max-width: 420px)')
  const narrowCaptionRule = narrowStart < 0 ? '' : css.slice(narrowStart)
  if (!narrowCaptionRule.includes('.session-caption')) failures.push('narrow layout must explicitly handle session caption overflow')
  return {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    css: { path: cssPath, missingRules },
    screenshots,
    failures,
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await inspectVisualContract()
  console.log(JSON.stringify(report))
  if (report.failures.length > 0) process.exitCode = 1
}
