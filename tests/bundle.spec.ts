import { describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/index.js'

describe('dsh-selection-companion bundle entry', () => {
  it('exports the expected Cordis plugin name', () => {
    expect(name).toBe('selection-companion')
  })

  it('loads without requiring services during Task 1', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(() => apply({} as never)).not.toThrow()
    expect(log).toHaveBeenCalledWith('[selection-companion] plugin loaded!')

    log.mockRestore()
  })
})
