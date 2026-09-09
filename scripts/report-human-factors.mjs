import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { analyzeHumanFactors } from './human-factors.mjs'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const input = argument('input')
const candidateSha = argument('candidate-sha')
if (input === undefined || candidateSha === undefined) {
  console.error('usage: pnpm report:human-factors -- --input <json> --candidate-sha <40-char-sha> [--output <json>]')
  process.exitCode = 2
} else {
  try {
    const data = JSON.parse(await readFile(resolve(input), 'utf8'))
    const report = analyzeHumanFactors(data, candidateSha)
    const output = argument('output') ?? resolve(dirname(input), `${basename(input, '.json')}.report.json`)
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ status: report.status, output, candidateSha: report.candidateSha, conditions: report.conditions }))
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  }
}
