import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

function fail(message) {
  console.error(`[verify-bundle] ${message}`)
  process.exitCode = 1
}

if (pkg.name !== 'dsh-selection-companion') {
  fail(`unexpected package name: ${String(pkg.name)}`)
}

if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
  fail('package.json must declare dsh.bundle.patch as ./cordis.patch.yml')
}

const entrypoints = [
  {
    id: 'selection-context',
    specifier: 'dsh-selection-companion/context',
    exportKey: './context',
    js: './lib/context/plugin.js',
    dts: './lib/context/plugin.d.ts',
  },
  {
    id: 'selection-sessions',
    specifier: 'dsh-selection-companion/session',
    exportKey: './session',
    js: './lib/session/plugin.js',
    dts: './lib/session/plugin.d.ts',
  },
  {
    id: 'selection-bridge',
    specifier: 'dsh-selection-companion/bridge',
    exportKey: './bridge',
    js: './lib/bridge/plugin.js',
    dts: './lib/bridge/plugin.d.ts',
  },
]

const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
for (const entry of entrypoints) {
  if (!patch.includes(`- id: ${entry.id}`)) {
    fail(`cordis.patch.yml is missing Loader row ${entry.id}`)
  }
  if (!patch.includes(`name: ${entry.specifier}`)) {
    fail(`cordis.patch.yml does not load ${entry.specifier}`)
  }

  const exported = pkg.exports?.[entry.exportKey]
  if (exported?.default !== entry.js || exported?.types !== entry.dts) {
    fail(`package.json export ${entry.exportKey} must point at ${entry.js} / ${entry.dts}`)
  }
}

if (/^\s*name:\s+dsh-selection-companion\s*$/m.test(patch)) {
  fail('cordis.patch.yml must not load the legacy root plugin entry')
}

for (const file of [
  'lib/index.js',
  'lib/index.d.ts',
  ...entrypoints.flatMap(entry => [entry.js.slice(2), entry.dts.slice(2)]),
]) {
  try {
    await access(resolve(root, file))
  } catch {
    fail(`missing build artifact: ${file}`)
  }
}

if (process.exitCode === undefined) {
  console.log('[verify-bundle] bundle exposes three Loader-visible Cordis service entries')
}
