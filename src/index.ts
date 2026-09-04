import type { Context } from '@deepseek-ai/cordis'
import { SelectionCompanionBridgeService } from './bridge/server.js'
import { SelectionContextService } from './context/service.js'

export const name = 'selection-companion'

export async function apply(ctx: Context): Promise<void> {
  const selectionContextFiber = ctx.plugin(SelectionContextService)
  await selectionContextFiber.await()

  const bridgeFiber = ctx.plugin(SelectionCompanionBridgeService)
  await bridgeFiber.await()

  console.log('[selection-companion] plugin loaded!')
}

export * from './bridge/index.js'
export * from './context/cache.js'
export * from './context/service.js'
export * from './context/snapshot.js'
