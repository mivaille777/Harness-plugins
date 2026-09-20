import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SelectionBridgePlugin from '../src/bridge/plugin.js'
import SelectionContextPlugin from '../src/context/plugin.js'
import SelectionSessionsPlugin from '../src/session/plugin.js'
import {
  SelectionCompanionBridgeService,
  SelectionCompanionSessionService,
  SelectionContextService,
} from '../src/index.js'

describe('dsh-selection-companion Cordis Loader entries', () => {
  it('exports each runtime capability as a first-class Service plugin', () => {
    expect(SelectionContextPlugin).toBe(SelectionContextService)
    expect(SelectionSessionsPlugin).toBe(SelectionCompanionSessionService)
    expect(SelectionBridgePlugin).toBe(SelectionCompanionBridgeService)

    expect(SelectionCompanionSessionService.inject).toEqual([
      'agents',
      'agentDefaultModel',
      'sessionQuery',
      'tools',
    ])
    expect(SelectionCompanionBridgeService.inject).toEqual([
      'selectionContext',
      'selectionCompanionSessions',
    ])
  })

  it('mounts the three Loader entries without a parent apply() orchestration layer', async () => {
    const previous = process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE
    process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE = '1'
    const ctx = new Context()

    class RequiredHarnessService extends Service {
      constructor(context: Context, key: string) { super(context, key) }
    }

    new RequiredHarnessService(ctx, 'agents')
    new RequiredHarnessService(ctx, 'agentDefaultModel')
    new RequiredHarnessService(ctx, 'sessionQuery')
    new RequiredHarnessService(ctx, 'tools')

    try {
      await ctx.plugin(SelectionContextPlugin)
      await ctx.plugin(SelectionSessionsPlugin)
      await ctx.plugin(SelectionBridgePlugin)

      expect(ctx.selectionContext).toBeDefined()
      expect(ctx.selectionContext.current()).toBeUndefined()
      expect(ctx.selectionCompanionSessions).toBeDefined()
      expect(ctx.selectionCompanionBridge).toBeDefined()
      expect(ctx.selectionCompanionBridge.status()).toMatchObject({
        enabled: false,
        listening: false,
      })
    } finally {
      if (previous === undefined) delete process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE
      else process.env.DSH_SELECTION_COMPANION_DISABLE_BRIDGE = previous
      await ctx.fiber.dispose()
    }
  })
})
