import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(here, '../fixtures/selection.html')
const contentScriptPath = resolve(here, '../../dist/content.js')

test('publishes a real DOM selection capture from mouseup', async ({ page }) => {
  const html = await readFile(fixturePath, 'utf8')
  await page.setContent(html)
  await page.evaluate(() => {
    ;(window as unknown as { __dshMessages: unknown[] }).__dshMessages = []
    ;(globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage(message: unknown) {
          ;(window as unknown as { __dshMessages: unknown[] }).__dshMessages.push(message)
          return Promise.resolve()
        },
      },
    }
  })
  await page.addScriptTag({ path: contentScriptPath })

  await page.evaluate(() => {
    const paragraph = document.querySelector('#target')!
    const text = paragraph.firstChild as Text
    const start = text.data.indexOf('exploitation')
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, start + 'exploitation'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

  await page.waitForFunction(() => {
    return (window as unknown as { __dshMessages: unknown[] }).__dshMessages.length > 0
  })

  const message = await page.evaluate(() => {
    return (window as unknown as { __dshMessages: unknown[] }).__dshMessages[0]
  }) as {
    type: string
    payload: {
      text: string
      heading?: string
      before?: string
      after?: string
      frameUrl: string
      topLevel: boolean
    }
  }

  expect(message.type).toBe('dsh-selection-capture')
  expect(message.payload.text).toBe('exploitation')
  expect(message.payload.heading).toBe('3.2 Acquisition Function')
  expect(message.payload.before).toContain('exploration and')
  expect(message.payload.after).toContain('under uncertainty')
  expect(message.payload.topLevel).toBe(true)
  expect(message.payload.frameUrl).toBe('about:blank')
})
