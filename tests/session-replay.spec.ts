import { describe, expect, it } from 'vitest'

const recordedSession = [
  { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'Selected material:\n\nA fixed source excerpt.\n\nExplain it.' }], source: { kind: 'plugin', plugin: 'selection-companion' } } },
  { type: 'assistant/message', data: { role: 'assistant', content: [{ type: 'text', text: 'Recorded answer.' }] } },
] as const

describe('selection companion session replay fixture', () => {
  it('keeps the complete model-visible selection prompt in the durable user-message event', () => {
    const input = recordedSession.find(event => event.type === 'user/message')?.data
    expect(input).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Selected material:\n\nA fixed source excerpt.\n\nExplain it.' }],
      source: { kind: 'plugin', plugin: 'selection-companion' },
    })
  })
})
