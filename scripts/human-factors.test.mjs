import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeHumanFactors, validateHumanFactorsData, validateStudyPlan } from './human-factors.mjs'

const candidateSha = '1'.repeat(40)
const observation = (id, condition) => ({
  observationId: id,
  condition,
  taskId: 'term-explanation',
  completed: true,
  durationMs: condition === 'baseline' ? 1000 : 700,
  criticalFactOmissions: 0,
  sourceAttributionErrors: 0,
  misoperations: 0,
  scopeJudgmentCorrect: true,
  recoverySuccess: true,
  rawTlx: 30,
})

test('human-factors fixture validator accepts anonymized observations', () => {
  const data = { schemaVersion: 1, studyId: 'study', candidateSha, observations: [observation('a', 'baseline'), observation('b', 'companion')] }
  assert.deepEqual(validateHumanFactorsData(data, candidateSha), [])
  assert.equal(analyzeHumanFactors(data, candidateSha).comparison.durationReductionPercent, 30)
})

test('human-factors validator rejects empty, mismatched, duplicate, and sensitive data', () => {
  const data = { schemaVersion: 1, studyId: 'study', candidateSha, observations: [observation('a', 'baseline'), observation('a', 'companion')] }
  data.observations[1].answer = 'must not be retained'
  const issues = validateHumanFactorsData(data, '2'.repeat(40))
  assert.match(issues.join('; '), /candidateSha does not match/)
  assert.match(issues.join('; '), /duplicate observationId/)
  assert.match(issues.join('; '), /sensitive field/)
  assert.throws(() => analyzeHumanFactors({ schemaVersion: 1, studyId: 'study', candidateSha, observations: [] }), /observations must contain/)
})

test('study plan requires success criteria for each task', () => {
  const issues = validateStudyPlan({ schemaVersion: 1, studyId: 'study', tasks: [{ id: 'task', successCriteria: [] }] })
  assert.match(issues.join('; '), /successCriteria/)
})
