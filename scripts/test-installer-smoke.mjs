import { spawn } from 'node:child_process'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeArtifacts, findInstallerArtifacts, readInstallerMetadata, validateInstallerMetadata } from './installer.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadata = await readInstallerMetadata(root)
const issues = await validateInstallerMetadata(metadata)
if (process.platform !== 'win32') issues.push('the installer smoke requires Windows')
const artifacts = await findInstallerArtifacts(metadata.artifactDirectory)
const installers = artifacts.filter(path => path.toLowerCase().endsWith('-setup.exe'))
if (installers.length !== 1) issues.push(`expected exactly one NSIS setup executable, found ${installers.length}`)

const candidateSha = process.env.R08_CANDIDATE_SHA ?? await gitHead()
const smokeRoot = await mkdtemp(join(tmpdir(), 'dsh-selection-companion-install-smoke-'))
const installDirectory = join(smokeRoot, 'app')
assertOwnedPath(smokeRoot, installDirectory)
const reportPath = process.env.R08_INSTALLER_SMOKE_REPORT ?? join(tmpdir(), `dsh-selection-companion-installer-smoke-${Date.now()}.json`)
const stages = []
let appProcess

try {
  if (issues.length > 0) throw new Error(issues.join('; '))
  const installer = installers[0]
  await runStage('install', installer, ['/S', `/D=${installDirectory}`], 120_000)
  const application = await findInstalledExecutable(installDirectory)
  stages.push({ name: 'installed-files', status: 'PASS', executable: basename(application) })

  appProcess = spawn(application, [], { stdio: 'ignore', windowsHide: true })
  await waitForSpawn(appProcess)
  await delay(1_500)
  if (appProcess.exitCode !== null) throw new Error(`installed application exited during startup with code ${appProcess.exitCode}`)
  stages.push({ name: 'launch', status: 'PASS' })
  await stopProcess(appProcess)
  appProcess = undefined

  await runStage('reinstall', installer, ['/S', `/D=${installDirectory}`], 120_000)
  const uninstaller = await findUninstaller(installDirectory)
  stages.push({ name: 'upgrade-files', status: 'PASS', uninstaller: basename(uninstaller) })
  await runStage('uninstall', uninstaller, ['/S'], 120_000)

  const remainingExecutables = await waitForNoExecutables(installDirectory, 15_000)
  if (remainingExecutables.length > 0) throw new Error(`uninstall left executable files: ${remainingExecutables.map(path => relative(installDirectory, path)).join(', ')}`)
  stages.push({ name: 'uninstall-files', status: 'PASS' })

  const report = {
    schemaVersion: 1,
    status: 'PASS',
    candidateSha,
    platform: process.platform,
    versions: { plugin: metadata.packageVersion, native: metadata.nativeVersion, tauri: metadata.tauriVersion },
    artifacts: await describeArtifacts(metadata.artifactDirectory, [installer]),
    stages,
    limitations: [
      'The smoke uses the current Windows user and an isolated temporary install directory.',
      'It does not prove code signing, a second Windows account, or a cross-version migration.',
      'Harness session data is outside the owned smoke directory and is not modified or removed.',
    ],
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: report.status, report: reportPath, candidateSha, artifacts: report.artifacts, stages }))
} catch (error) {
  const report = { schemaVersion: 1, status: 'FAIL', candidateSha, stages, message: error instanceof Error ? error.message : String(error) }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.error(JSON.stringify({ status: report.status, report: reportPath, message: report.message, stages }))
  process.exitCode = 1
} finally {
  if (appProcess !== undefined) await stopProcess(appProcess).catch(() => {})
  assertOwnedPath(tmpdir(), smokeRoot)
  await rm(smokeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

async function gitHead() {
  const result = await run('git', ['rev-parse', 'HEAD'], 10_000)
  if (result.code !== 0) throw new Error(`git rev-parse failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

async function runStage(name, executable, args, timeoutMs) {
  const result = await run(executable, args, timeoutMs)
  if (result.code !== 0) throw new Error(`${name} exited with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`)
  stages.push({ name, status: 'PASS', exitCode: result.code })
}

function run(executable, args, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${basename(executable)} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    child.once('close', code => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr })
    })
  })
}

async function findInstalledExecutable(directory) {
  const matches = await findFiles(directory, name => name === 'dsh-selection-companion-native.exe')
  if (matches.length !== 1) throw new Error(`expected one installed application executable, found ${matches.length}`)
  await access(matches[0])
  return matches[0]
}

async function findUninstaller(directory) {
  const matches = await findFiles(directory, name => /^(uninstall|unins.*)\.exe$/i.test(name))
  if (matches.length !== 1) throw new Error(`expected one uninstaller executable, found ${matches.length}`)
  return matches[0]
}

async function findFiles(directory, predicate) {
  const matches = []
  const visit = async current => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (predicate(entry.name)) matches.push(path)
    }
  }
  await visit(directory)
  return matches
}

async function waitForNoExecutables(directory, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let matches = []
  do {
    matches = await findFiles(directory, name => name.toLowerCase().endsWith('.exe'))
    if (matches.length === 0) return matches
    await delay(200)
  } while (Date.now() < deadline)
  return matches
}

function waitForSpawn(child) {
  if (child.pid !== undefined) return Promise.resolve()
  return new Promise((resolveSpawn, reject) => {
    child.once('spawn', resolveSpawn)
    child.once('error', reject)
  })
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  child.kill()
  const exited = await Promise.race([
    new Promise(resolveExit => child.once('close', () => resolveExit(true))),
    delay(5_000).then(() => false),
  ])
  if (!exited && child.pid !== undefined) {
    const result = await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], 10_000)
    if (result.code !== 0 && !/not found/i.test(result.stderr)) throw new Error(`could not stop installed application: ${result.stderr.trim()}`)
  }
}

function assertOwnedPath(parent, child) {
  const resolvedParent = resolve(parent)
  const resolvedChild = resolve(child)
  if (resolvedChild === resolvedParent || !resolvedChild.startsWith(`${resolvedParent}${sep}`)) throw new Error(`refusing path outside owned directory: ${resolvedChild}`)
}

function delay(milliseconds) { return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds)) }
