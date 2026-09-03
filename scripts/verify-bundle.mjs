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

const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes('id: selection-companion')) {
  fail('cordis.patch.yml is missing the selection-companion row id')
}
if (!patch.includes('name: dsh-selection-companion')) {
  fail('cordis.patch.yml does not resolve the installed package by package name')
}

for (const file of ['lib/index.js', 'lib/index.d.ts']) {
  try {
    await access(resolve(root, file))
  } catch {
    fail(`missing build artifact: ${file}`)
  }
}

if (process.exitCode === undefined) {
  console.log('[verify-bundle] bundle manifest and build artifacts are valid')
}
