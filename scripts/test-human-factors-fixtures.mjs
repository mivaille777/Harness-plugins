import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validateStudyPlan, validateHumanFactorsData } from './human-factors.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const studyPath = resolve(root, 'tests/fixtures/human-factors-study.json')
const dataPath = resolve(root, 'tests/fixtures/human-factors-observations.sample.json')
const study = JSON.parse(await readFile(studyPath, 'utf8'))
const data = JSON.parse(await readFile(dataPath, 'utf8'))
const issues = [...validateStudyPlan(study), ...validateHumanFactorsData(data)]
if (issues.length > 0) {
  console.error(JSON.stringify({ status: 'FAIL', issues }))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ status: 'PASS', study: study.studyId, observations: data.observations.length, candidateSha: data.candidateSha }))
}
