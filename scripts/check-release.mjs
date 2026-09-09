import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createManifestSkeleton, currentCandidateSha, validateReleaseManifest } from './release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const candidateSha = argument('candidate-sha') ?? currentCandidateSha(root)
const manifestPath = argument('manifest')
const outputPath = argument('output')
let manifest
let issues = []
let warnings = []
if (manifestPath === undefined) {
  manifest = await createManifestSkeleton(root, candidateSha)
  warnings.push('no --manifest was supplied; generated a pending skeleton')
} else {
  try {
    manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'))
  } catch (error) {
    issues.push(`manifest could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (candidateSha === null) issues.push('current candidate SHA could not be read')
if (manifest !== undefined) {
  const result = await validateReleaseManifest(manifest, { root, candidateSha: candidateSha ?? undefined })
  issues.push(...result.issues)
  warnings.push(...result.warnings)
}
const status = issues.length > 0 ? 'FAIL' : warnings.length > 0 || manifestPath === undefined ? 'NOT READY' : 'READY'
const report = { schemaVersion: 1, status, candidateSha, manifestPath: manifestPath ?? null, issues, warnings, manifest }
if (outputPath !== undefined) await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ status, candidateSha, manifest: manifestPath ?? 'generated skeleton', issues, warnings }))
process.exitCode = status === 'READY' ? 0 : status === 'NOT READY' ? 2 : 1
