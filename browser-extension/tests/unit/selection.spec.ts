import { beforeEach, describe, expect, it } from 'vitest'
import { captureBrowserSelection } from '../../src/selection'

function selectText(node: Text, start: number, end: number): void {
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

describe('captureBrowserSelection', () => {
  beforeEach(() => {
    document.documentElement.lang = 'en'
    document.title = 'Safe Bayesian Optimization'
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('preserves exact DOM selection while extracting heading and nearby context', () => {
    document.body.innerHTML = `
      <section>
        <h2>3.2 Acquisition Function</h2>
        <p id="target">The acquisition function balances exploration and exploitation under uncertainty.</p>
      </section>
    `
    const paragraph = document.querySelector('#target')!
    const text = paragraph.firstChild as Text
    const start = text.data.indexOf('exploitation')
    selectText(text, start, start + 'exploitation'.length)

    const capture = captureBrowserSelection(document, window)

    expect(capture?.text).toBe('exploitation')
    expect(capture?.heading).toBe('3.2 Acquisition Function')
    expect(capture?.before).toContain('balances exploration and')
    expect(capture?.after).toContain('under uncertainty')
    expect(capture?.sectionText).not.toContain('Safe Bayesian Optimization')
    expect(capture?.sectionText).toContain('Acquisition Function')
    expect(capture?.language).toBe('en')
  })

  it('captures input selections without touching the clipboard', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = 'alpha beta gamma'
    document.body.append(input)
    input.focus()
    input.setSelectionRange(6, 10)

    const capture = captureBrowserSelection(document, window)

    expect(capture?.text).toBe('beta')
    expect(capture?.before).toBe('alpha')
    expect(capture?.after).toBe('gamma')
  })

  it('ignores collapsed and whitespace-only selections', () => {
    document.body.textContent = '   '
    const text = document.body.firstChild as Text
    selectText(text, 0, text.data.length)
    expect(captureBrowserSelection(document, window)).toBeNull()

    window.getSelection()?.removeAllRanges()
    expect(captureBrowserSelection(document, window)).toBeNull()
  })
})
