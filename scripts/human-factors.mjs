export const HUMAN_FACTORS_SCHEMA_VERSION = 1
export const HUMAN_FACTORS_CONDITIONS = ['baseline', 'companion']
const SHA_PATTERN = /^[0-9a-f]{40}$/
const FORBIDDEN_KEYS = new Set(['text', 'url', 'answer', 'prompt', 'email', 'token', 'sourceText', 'selectionText'])

/** Validate the task and metric fields of the anonymized study plan. */
export function validateStudyPlan(value) {
  const issues = []
  if (!isRecord(value) || value.schemaVersion !== HUMAN_FACTORS_SCHEMA_VERSION) issues.push('unsupported study plan schema')
  if (!isRecord(value) || typeof value.studyId !== 'string' || value.studyId.trim() === '') issues.push('studyId is required')
  if (!isRecord(value) || !Array.isArray(value.tasks) || value.tasks.length === 0) issues.push('study plan needs at least one task')
  if (isRecord(value) && Array.isArray(value.tasks)) {
    const ids = new Set()
    for (const task of value.tasks) {
      if (!isRecord(task) || typeof task.id !== 'string' || task.id.trim() === '') issues.push('every task needs an id')
      else if (ids.has(task.id)) issues.push(`duplicate task id: ${task.id}`)
      else ids.add(task.id)
      if (!isRecord(task) || !Array.isArray(task.successCriteria) || task.successCriteria.length === 0) issues.push(`task ${String(task?.id ?? '')} needs successCriteria`)
    }
  }
  issues.push(...forbiddenKeyIssues(value))
  return issues
}

/** Validate anonymized observations and optionally bind them to a candidate SHA. */
export function validateHumanFactorsData(value, expectedCandidateSha) {
  const issues = []
  if (!isRecord(value) || value.schemaVersion !== HUMAN_FACTORS_SCHEMA_VERSION) issues.push('unsupported human-factors data schema')
  if (!isRecord(value) || typeof value.studyId !== 'string' || value.studyId.trim() === '') issues.push('studyId is required')
  const candidateSha = isRecord(value) && typeof value.candidateSha === 'string' ? value.candidateSha : ''
  if (!SHA_PATTERN.test(candidateSha)) issues.push('candidateSha must be a 40-character git SHA')
  if (expectedCandidateSha !== undefined && candidateSha !== expectedCandidateSha) issues.push('candidateSha does not match the requested candidate')
  if (!isRecord(value) || !Array.isArray(value.observations) || value.observations.length === 0) issues.push('observations must contain at least one anonymized row')
  const ids = new Set()
  if (isRecord(value) && Array.isArray(value.observations)) {
    for (const observation of value.observations) {
      const issue = validateObservation(observation, ids)
      if (issue !== null) issues.push(issue)
    }
  }
  issues.push(...forbiddenKeyIssues(value))
  return issues
}

/** Produce descriptive condition metrics without inferring population-wide effects. */
export function analyzeHumanFactors(value, expectedCandidateSha) {
  const issues = validateHumanFactorsData(value, expectedCandidateSha)
  if (issues.length > 0) throw new Error(issues.join('; '))
  const observations = value.observations
  const byCondition = Object.fromEntries(HUMAN_FACTORS_CONDITIONS.map(condition => [condition, summarizeCondition(observations.filter(observation => observation.condition === condition))]))
  const baseline = byCondition.baseline
  const companion = byCondition.companion
  const durationReductionPercent = baseline.medianDurationMs === null || baseline.medianDurationMs === 0 || companion.medianDurationMs === null
    ? null
    : ((baseline.medianDurationMs - companion.medianDurationMs) / baseline.medianDurationMs) * 100
  return {
    schemaVersion: HUMAN_FACTORS_SCHEMA_VERSION,
    status: 'DESCRIPTIVE_ONLY',
    candidateSha: value.candidateSha,
    studyId: value.studyId,
    conditions: byCondition,
    comparison: { durationReductionPercent },
    conclusion: 'Descriptive sample summary only; no general human-factors effect is established.',
  }
}

function validateObservation(value, ids) {
  if (!isRecord(value)) return 'each observation must be an object'
  if (typeof value.observationId !== 'string' || value.observationId.trim() === '') return 'observationId is required'
  if (ids.has(value.observationId)) return `duplicate observationId: ${value.observationId}`
  ids.add(value.observationId)
  if (!HUMAN_FACTORS_CONDITIONS.includes(value.condition)) return `unsupported condition for ${value.observationId}`
  if (typeof value.taskId !== 'string' || value.taskId.trim() === '') return `taskId is required for ${value.observationId}`
  if (typeof value.completed !== 'boolean') return `completed must be boolean for ${value.observationId}`
  for (const field of ['durationMs', 'criticalFactOmissions', 'sourceAttributionErrors', 'misoperations', 'rawTlx']) {
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0) return `${field} must be a non-negative number for ${value.observationId}`
  }
  if (!Number.isInteger(value.durationMs) || !Number.isInteger(value.criticalFactOmissions) || !Number.isInteger(value.sourceAttributionErrors) || !Number.isInteger(value.misoperations)) return `count and duration fields must be integers for ${value.observationId}`
  if (value.rawTlx > 100) return `rawTlx must be between 0 and 100 for ${value.observationId}`
  if (typeof value.scopeJudgmentCorrect !== 'boolean' || typeof value.recoverySuccess !== 'boolean') return `boolean outcome fields are required for ${value.observationId}`
  return null
}

function summarizeCondition(observations) {
  if (observations.length === 0) return {
    sampleCount: 0,
    completionRate: null,
    medianDurationMs: null,
    meanCriticalFactOmissions: null,
    meanSourceAttributionErrors: null,
    meanMisoperations: null,
    scopeJudgmentAccuracy: null,
    recoverySuccessRate: null,
    meanRawTlx: null,
  }
  return {
    sampleCount: observations.length,
    completionRate: rate(observations, observation => observation.completed),
    medianDurationMs: median(observations.map(observation => observation.durationMs)),
    meanCriticalFactOmissions: mean(observations.map(observation => observation.criticalFactOmissions)),
    meanSourceAttributionErrors: mean(observations.map(observation => observation.sourceAttributionErrors)),
    meanMisoperations: mean(observations.map(observation => observation.misoperations)),
    scopeJudgmentAccuracy: rate(observations, observation => observation.scopeJudgmentCorrect),
    recoverySuccessRate: rate(observations, observation => observation.recoverySuccess),
    meanRawTlx: mean(observations.map(observation => observation.rawTlx)),
  }
}

function rate(values, predicate) { return values.filter(predicate).length / values.length }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length }
function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
function isRecord(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function forbiddenKeyIssues(value, path = '$') {
  if (!isRecord(value) && !Array.isArray(value)) return []
  const issues = []
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) issues.push(`sensitive field is not allowed: ${path}.${key}`)
    issues.push(...forbiddenKeyIssues(child, `${path}.${key}`))
  }
  return issues
}
