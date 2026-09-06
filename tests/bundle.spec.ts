import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  SelectionCompanionBridgeService,
  SelectionCompanionSessionService,
  SelectionContextService,
  apply,
  name,
} from '../src/index.js'

describe('dsh-selection-companion bundle entry', () => {
  it('exports the expected Cordis plugin name', () => {
    expect(name).toBe('selection-companion')
  })

  it('mounts services as Cordis class plugins and publishes Harness capabilities', async () => {
    const previous = process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE
    process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE = '1'
    const ctx = new Context()
    class RequiredHarnessService extends Service {
      constructor(context: Context, key: string) { super(context, key) }
    }
    new RequiredHarnessService(ctx, 'agents')
    new RequiredHarnessService(ctx, 'agentDefaultModel')
    new RequiredHarnessService(ctx, 'sessionQuery')
    const plugin = vi.spyOn(ctx, 'plugin')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    try {
      await expect(apply(ctx)).resolves.toBeUndefined()
      expect(plugin).toHaveBeenCalledWith(SelectionContextService)
      expect(plugin).toHaveBeenCalledWith(SelectionCompanionSessionService)
      expect(plugin).toHaveBeenCalledWith(SelectionCompanionBridgeService)
      expect(ctx.selectionContext).toBeDefined()
      expect(ctx.selectionContext.current()).toBeUndefined()
      expect(ctx.selectionCompanionBridge).toBeDefined()
      expect(ctx.selectionCompanionBridge.status().listening).toBe(false)
      expect(log).toHaveBeenCalledWith('[selection-companion] plugin loaded!')
    } finally {
      plugin.mockRestore()
      log.mockRestore()
      if (previous === undefined) delete process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE
      else process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE = previous
      await ctx.fiber.dispose()
    }
  })
})
