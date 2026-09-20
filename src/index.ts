import type { Context } from '@deepseek-ai/cordis'
import { SelectionCompanionBridgeService } from './bridge/server.js'
import { SelectionContextService } from './context/service.js'
import { SelectionCompanionSessionService } from './session/service.js'

/** @deprecated The installable bundle now exposes three direct Loader entries. */
export const name = 'selection-companion'

/**
 * @deprecated Kept only for programmatic compatibility. The shipped bundle
 * loads ./context, ./session, and ./bridge directly so Cordis owns dependency
 * waiting and exposes each Fiber's lifecycle independently.
 */
export async function apply(ctx: Context): Promise<void> {
  const selectionContextFiber = ctx.plugin(SelectionContextService)
  await selectionContextFiber.await()

  const sessionFiber = ctx.plugin(SelectionCompanionSessionService)
  await sessionFiber.await()

  const bridgeFiber = ctx.plugin(SelectionCompanionBridgeService)
  await bridgeFiber.await()

  console.log('[selection-companion] plugin loaded!')
}

export * from './bridge/index.js'
export * from './context/cache.js'
export * from './context/expansion.js'
export * from './context/service.js'
export * from './context/snapshot.js'
export * from './session/service.js'

export { default as SelectionContextPlugin } from './context/plugin.js'
export { default as SelectionSessionsPlugin } from './session/plugin.js'
export { default as SelectionBridgePlugin } from './bridge/plugin.js'
