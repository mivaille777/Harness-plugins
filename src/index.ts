import type { Context } from '@deepseek-ai/cordis'
import { SelectionCompanionBridgeService } from './bridge/server.js'
import { SelectionContextService } from './context/service.js'

export const name = 'selection-companion'

export function apply(ctx: Context): void {
  new SelectionContextService(ctx)
  new SelectionCompanionBridgeService(ctx)
  console.log('[selection-companion] plugin loaded!')
}

export * from './bridge/index.js'
export * from './context/cache.js'
export * from './context/service.js'
export * from './context/snapshot.js'
