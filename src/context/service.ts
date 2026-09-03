import { Service, type Context } from '@deepseek-ai/cordis'
import {
  SelectionSnapshotCache,
  type SelectionSnapshotCacheOptions,
  type SelectionSnapshotUpdateResult,
} from './cache.js'
import type { SelectionSnapshot } from './snapshot.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    selectionContext: SelectionContextService
  }
}

/**
 * Cordis capability seam for the user's ambient selection state.
 * Consumers should depend on this service instead of talking to native providers directly.
 */
export class SelectionContextService extends Service {
  private readonly cache: SelectionSnapshotCache

  constructor(ctx: Context, options: SelectionSnapshotCacheOptions = {}) {
    super(ctx, 'selectionContext')
    this.cache = new SelectionSnapshotCache(options)
  }

  update(snapshot: SelectionSnapshot): SelectionSnapshotUpdateResult {
    return this.cache.update(snapshot)
  }

  current(): SelectionSnapshot | undefined {
    return this.cache.current()
  }

  get(snapshotId: string): SelectionSnapshot | undefined {
    return this.cache.get(snapshotId)
  }

  clear(snapshotId?: string): void {
    this.cache.clear(snapshotId)
  }

  purgeExpired(): number {
    return this.cache.purgeExpired()
  }

  get size(): number {
    return this.cache.size
  }
}
