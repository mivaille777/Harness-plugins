import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const INSTALLER_SCHEMA_VERSION = 1
export const INSTALLER_ARTIFACT_EXTENSIONS = ['.msi', '.exe', '.nsis.zip']
const SHA_PATTERN = /^[0-9a-f]{40}$/
const SENSITIVE_DIAGNOSTIC_KEYS = new Set([
  'selection',
  'selectionText',
  'text',
  'content',
  'prompt',
  'answer',
  'url',
  'filePath',
  'token',
  'authorization',
  'apiKey',
])

/** Read version and bundle metadata without changing the host machine. */
export async function readInstallerMetadata(root) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const tauri = JSON.parse(await readFile(join(root, 'native', 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const cargo = await readFile(join(root, 'native', 'src-tauri', 'Cargo.toml'), 'utf8')
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
  return {
    packageVersion: packageJson.version,
    nativeVersion: cargoVersion,
    tauriVersion: tauri.version,
    identifier: tauri.identifier,
    bundleActive: tauri.bundle?.active === true,
    frontendDist: tauri.build?.frontendDist,
    beforeBuildCommand: tauri.build?.beforeBuildCommand,
    iconPath: join(root, 'native', 'src-tauri', 'icons', 'icon.ico'),
    artifactDirectory: join(root, 'native', 'src-tauri', 'target', 'release', 'bundle'),
  }
}

/** Validate the release-facing metadata and report actionable configuration errors. */
export async function validateInstallerMetadata(metadata) {
  const issues = []
  if (typeof metadata.packageVersion !== 'string' || metadata.packageVersion.trim() === '') issues.push('package version is missing')
  if (metadata.packageVersion !== metadata.nativeVersion || metadata.packageVersion !== metadata.tauriVersion) issues.push('package, Cargo, and Tauri versions must match')
  if (typeof metadata.identifier !== 'string' || !/^io\.github\.[a-z0-9-]+\.[a-z0-9-]+$/.test(metadata.identifier)) issues.push('Tauri identifier must use the io.github owner.product form')
  if (metadata.frontendDist !== '../dist') issues.push('Tauri frontendDist must point to ../dist')
  if (metadata.beforeBuildCommand !== 'pnpm build') issues.push('Tauri beforeBuildCommand must build the native frontend')
  try {
    await access(metadata.iconPath)
  } catch {
    issues.push('Tauri icon.ico is missing')
  }
  return issues
}

/** Recursively remove material and credential fields from a diagnostic value. */
export function redactDiagnostic(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostic)
  if (typeof value !== 'object' || value === null) return value
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_DIAGNOSTIC_KEYS.has(key) ? '[redacted]' : redactDiagnostic(child)
  }
  return output
}

/** Build a diagnostic record suitable for support logs without exposing selected material. */
export function buildDiagnosticReport({ metadata, candidateSha, bridge, capture, errors = [] }) {
  if (!SHA_PATTERN.test(candidateSha)) throw new RangeError('candidateSha must be a 40-character git SHA')
  return redactDiagnostic({
    schemaVersion: INSTALLER_SCHEMA_VERSION,
    status: 'DIAGNOSTIC_ONLY',
    candidateSha,
    versions: {
      plugin: metadata.packageVersion,
      native: metadata.nativeVersion,
      protocol: 3,
    },
    bridge: {
      connected: bridge?.connected === true,
      lastErrorCode: typeof bridge?.lastErrorCode === 'string' ? bridge.lastErrorCode : null,
    },
    capture: {
      phase: typeof capture?.phase === 'string' ? capture.phase : 'unknown',
      paused: capture?.paused === true,
      metrics: capture?.metrics ?? null,
    },
    errors,
  })
}

/** Find installer artifacts under the owned release directory. */
export async function findInstallerArtifacts(directory) {
  const names = []
  const visit = async current => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) await visit(fullPath)
      else if (INSTALLER_ARTIFACT_EXTENSIONS.some(extension => entry.name.toLowerCase().endsWith(extension))) names.push(fullPath)
    }
  }
  await visit(directory)
  return names.sort()
}

/** Hash an installer artifact for a release manifest. */
export async function sha256File(filePath) {
  const bytes = await readFile(filePath)
  return createHash('sha256').update(bytes).digest('hex')
}

/** Produce artifact entries with paths relative to the release directory. */
export async function describeArtifacts(directory, files) {
  return Promise.all(files.map(async filePath => ({
    name: basename(filePath),
    relativePath: filePath.slice(resolve(directory).length + 1),
    sha256: await sha256File(filePath),
  })))
}
