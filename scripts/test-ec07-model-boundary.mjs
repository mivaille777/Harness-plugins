import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EC07_FORBIDDEN_SENTINEL,
  EC07_PAGE_SENTINEL,
  EC07_SELECTION_SENTINEL,
  canonicalEc07Prompt,
  requestPassedProbe,
  startModelBoundaryProbe,
  summarizeModelRequest,
} from './ec07-model-boundary.mjs'

test('EC-07 model request summary records only sentinel facts and a digest', () => {
  const payload = {
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: `${EC07_SELECTION_SENTINEL}\n${EC07_PAGE_SENTINEL}` }],
  }
  const summary = summarizeModelRequest(payload, [EC07_SELECTION_SENTINEL, EC07_PAGE_SENTINEL], [EC07_FORBIDDEN_SENTINEL])
  assert.equal(summary.model, 'deepseek-chat')
  assert.equal(summary.messageCount, 1)
  assert.equal(summary.expected[EC07_SELECTION_SENTINEL], true)
  assert.equal(summary.expected[EC07_PAGE_SENTINEL], true)
  assert.equal(summary.forbidden[EC07_FORBIDDEN_SENTINEL], false)
  assert.match(summary.messagesSha256, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(summary).includes('Reference material'), false)
})

test('EC-07 canonical fixture contains authorized sentinels and excludes unauthorized preview text', () => {
  const prompt = canonicalEc07Prompt()
  assert.match(prompt, new RegExp(EC07_SELECTION_SENTINEL))
  assert.match(prompt, new RegExp(EC07_PAGE_SENTINEL))
  assert.equal(prompt.includes(EC07_FORBIDDEN_SENTINEL), false)
  assert.match(prompt, /Authorized scope: page/)
  assert.match(prompt, /Actual scope: page/)
})

test('EC-07 probe rejects forbidden data even when required sentinels are present', () => {
  const request = {
    parseError: false,
    expected: {
      [EC07_SELECTION_SENTINEL]: true,
      [EC07_PAGE_SENTINEL]: true,
    },
    forbidden: { [EC07_FORBIDDEN_SENTINEL]: true },
  }
  assert.equal(requestPassedProbe(request), false)
})

test('EC-07 local SSE probe observes sentinels in an actual HTTP model request', async () => {
  const probe = await startModelBoundaryProbe()
  try {
    const response = await fetch(`${probe.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fixture-model',
        messages: [{ role: 'user', content: canonicalEc07Prompt() }],
        stream: true,
      }),
    })
    assert.equal(response.status, 200)
    await response.text()
    assert.equal(probe.requests.length, 1)
    assert.equal(requestPassedProbe(probe.requests[0]), true)
    assert.equal(probe.requests[0].expected[EC07_SELECTION_SENTINEL], true)
    assert.equal(probe.requests[0].expected[EC07_PAGE_SENTINEL], true)
    assert.equal(probe.requests[0].forbidden[EC07_FORBIDDEN_SENTINEL], false)
  } finally {
    await probe.close()
  }
})
