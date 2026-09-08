import { describe, expect, it } from 'vitest'
import { getAppCopy } from './copy'

describe('locale-owned product copy', () => {
  it('selects Chinese copy for Chinese browser locales', () => {
    const copy = getAppCopy('zh-CN')
    expect(copy.locale).toBe('zh-CN')
    expect(copy.explain).toBe('解释')
    expect(copy.phaseLabels.streaming).toBe('正在接收回答')
  })

  it('falls back to English for unsupported locales', () => {
    const copy = getAppCopy('fr-FR')
    expect(copy.locale).toBe('en-US')
    expect(copy.messages(1)).toBe('1 message')
    expect(copy.messages(2)).toBe('2 messages')
  })
})
