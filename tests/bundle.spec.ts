import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, name } from '../src/index.js'

describe('dsh-selection-companion bundle entry', () => {
  it('exports the expected Cordis plugin name', () => {
    expect(name).toBe('selection-companion')
  })

  it('loads and publishes Harness capabilities without opening a test pipe', async () => {
    const previous = process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE
    process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE = '1'
    const ctx = new Context()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      expect(() => apply(ctx)).not.toThrow()
      expect(ctx.selectionContext).toBeDefined()
      expect(ctx.selectionContext.current()).toBeUndefined()
      expect(ctx.selectionCompanionBridge).toBeDefined()
      expect(ctx.selectionCompanionBridge.status().listening).toBe(false)
      expect(log).toHaveBeenCalledWith('[selection-companion] plugin loaded!')
    } finally {
      log.mockRestore()
      if (previous === undefined) delete process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE
      else process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE = previous
      await ctx.fiber.dispose()
    }
  })
})
