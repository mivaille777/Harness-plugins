import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SelectionContextService, apply, name } from '../src/index.js'

describe('dsh-selection-companion bundle entry', () => {
  it('exports the expected Cordis plugin name', () => {
    expect(name).toBe('selection-companion')
  })

  it('loads and publishes the selectionContext Cordis service', () => {
    const ctx = new Context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    expect(() => apply(ctx)).not.toThrow()
    expect(ctx.selectionContext).toBeInstanceOf(SelectionContextService)
    expect(ctx.selectionContext.current()).toBeUndefined()
    expect(log).toHaveBeenCalledWith('[selection-companion] plugin loaded!')

    log.mockRestore()
  })
})
