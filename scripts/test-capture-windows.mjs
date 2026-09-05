import process from 'node:process'
import { existsSync } from 'node:fs'

const fixture = new URL('../tests/fixtures/capture-windows.html', import.meta.url)

if (process.platform !== 'win32') {
  console.error('SKIP: test:capture:windows requires Windows with UI Automation.')
  process.exitCode = 2
} else if (process.env.DSH_CAPTURE_WINDOWS_FIXTURE !== '1') {
  console.error('NOT RUN: set DSH_CAPTURE_WINDOWS_FIXTURE=1 after opening the documented Chrome or Edge fixture in an interactive desktop session.')
  console.error('This command intentionally fails instead of reporting an empty Windows UIA run as a pass.')
  process.exitCode = 2
} else if (!existsSync(fixture)) {
  console.error(`NOT RUN: missing UIA fixture at ${fixture.pathname}`)
  process.exitCode = 2
} else {
  console.error(`NOT RUN: open ${fixture.href} in Chrome or Edge, make each documented selection, and record the Harness result.`)
  console.error('The interactive fixture requires the manual assertions documented in docs/capture-reliability.md.')
  console.error('No automated success is emitted until a real browser selection fixture is implemented.')
  process.exitCode = 2
}
