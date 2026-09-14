import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EC08_GLOBAL_SENTINEL,
  EC08_PAGE_SENTINEL,
  EC08_PROTOCOL,
  EC08_SELECTION_SENTINEL,
  canonicalEc08Prompt,
  decodeEc08Frames,
  ec08GlobalSnapshot,
  ec08Material,
  ec08RequestMatches,
  encodeEc08Frame,
  startEc08ModelGate,
} from './ec08-session-model-boundary.mjs'

test('EC-08 canonical fixture contains only explicitly authorized sentinels', () => {
  const material = ec08Material()
  const prompt = canonicalEc08Prompt(material)
  const globalSnapshot = ec08GlobalSnapshot()

  assert.equal(material.authorizedScope, 'page')
  assert.equal(material.actualScope, 'page')
  assert.equal(material.selection.text, EC08_SELECTION_SENTINEL)
  assert.equal(material.context.pageText, EC08_PAGE_SENTINEL)
  assert.equal(prompt.includes(EC08_SELECTION_SENTINEL), true)
  assert.equal(prompt.includes(EC08_PAGE_SENTINEL), true)
  assert.equal(prompt.includes(EC08_GLOBAL_SENTINEL), false)
  assert.equal(JSON.stringify(material).includes(EC08_GLOBAL_SENTINEL), false)
  assert.equal(JSON.stringify(globalSnapshot).includes(EC08_GLOBAL_SENTINEL), true)
})

test('EC-08 framing survives chunk boundaries and retains Protocol V4 identity', () => {
  const message = {
    protocol: EC08_PROTOCOL,
    id: 'ec08-frame-test',
    type: 'session.create',
    payload: {},
  }
  const frame = encodeEc08Frame(message)
  const first = decodeEc08Frames(frame.subarray(0, 7))
  assert.deepEqual(first.messages, [])
  assert.equal(first.remainder.length, 7)

  const second = decodeEc08Frames(Buffer.concat([first.remainder, frame.subarray(7)]))
  assert.deepEqual(second.messages, [message])
  assert.equal(second.remainder.length, 0)
})

test('EC-08 request matcher requires authorized sentinels and rejects global contamination', () => {
  assert.equal(ec08RequestMatches({
    expected: {
      [EC08_SELECTION_SENTINEL]: true,
      [EC08_PAGE_SENTINEL]: true,
    },
    forbidden: { [EC08_GLOBAL_SENTINEL]: false },
  }), true)
  assert.equal(ec08RequestMatches({
    expected: {
      [EC08_SELECTION_SENTINEL]: true,
      [EC08_PAGE_SENTINEL]: true,
    },
    forbidden: { [EC08_GLOBAL_SENTINEL]: true },
  }), false)
  assert.equal(ec08RequestMatches({
    expected: {
      [EC08_SELECTION_SENTINEL]: true,
      [EC08_PAGE_SENTINEL]: false,
    },
    forbidden: { [EC08_GLOBAL_SENTINEL]: false },
  }), false)
})

test('EC-08 model gate holds bootstrap while recording only safe target-request facts', async () => {
  const gate = await startEc08ModelGate()
  try {
    const bootstrapFetch = fetch(`${gate.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'ec08-unit',
        messages: [{ role: 'user', content: 'EC08 bootstrap without target sentinels' }],
      }),
    })
    const bootstrapObservation = await gate.bootstrapStarted
    assert.equal(ec08RequestMatches(bootstrapObservation), false)

    const response = await fetch(`${gate.url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'ec08-unit',
        messages: [{ role: 'user', content: canonicalEc08Prompt() }],
      }),
    })
    assert.equal(response.ok, true)
    const body = await response.text()
    assert.equal(body.includes('EC08_SESSION_MODEL_OK'), true)
    await gate.matched

    assert.equal(gate.requests.length, 2)
    assert.equal(ec08RequestMatches(gate.requests[1]), true)
    assert.equal(typeof gate.requests[1].messagesSha256, 'string')
    assert.equal(Object.hasOwn(gate.requests[1], 'messages'), false)
    assert.equal(JSON.stringify(gate.requests[1]).includes(canonicalEc08Prompt()), false)

    gate.releaseBootstrap()
    const bootstrapResponse = await bootstrapFetch
    assert.equal(bootstrapResponse.ok, true)
    assert.equal((await bootstrapResponse.text()).includes('EC08_BOOTSTRAP_RELEASED'), true)
  } finally {
    await gate.close()
  }
})
