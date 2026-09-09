import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLocalExpansionBenchmark, parsePositiveInteger } from './perf.mjs'

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : parsePositiveInteger(process.argv[index + 1], name)
}

const report = runLocalExpansionBenchmark({
  iterations: option('iterations', 20),
  innerLoops: option('inner-loops', 100),
})
const output = process.env.R08_PERF_OUTPUT === undefined
  ? join(tmpdir(), `dsh-selection-companion-perf-${Date.now()}.json`)
  : process.env.R08_PERF_OUTPUT
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ status: report.status, output, operations: report.operations, unmeasuredOperations: report.unmeasuredOperations }))
