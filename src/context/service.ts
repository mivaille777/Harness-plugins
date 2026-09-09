import { Service, type Context } from '@deepseek-ai/cordis'
import {
  SelectionSnapshotCache,
  type SelectionSnapshotCacheOptions,
  type SelectionSnapshotUpdateResult,
} from './cache.js'
import {
  expandSelectionSnapshot,
  SelectionContextExpansionError,
  type SelectionContextExpansion,
  type SelectionContextExpansionOptions,
} from './expansion.js'
import type { SelectionSnapshot } from './snapshot.js'
import type { ContextScope } from '../bridge/protocol.js'

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
  private readonly expansionOptions: SelectionContextExpansionOptions

  constructor(ctx: Context, options: SelectionSnapshotCacheOptions & SelectionContextExpansionOptions = {}) {
    super(ctx, 'selectionContext')
    this.cache = new SelectionSnapshotCache(options)
    this.expansionOptions = {
      ...(options.maxCodePoints === undefined ? {} : { maxCodePoints: options.maxCodePoints }),
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    }
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

  /**
   * Return explicitly requested context captured with one immutable snapshot.
   *
   * @param snapshotId - identity of the fixed selection.
   * @param scope - context scope to expose.
   * @returns bounded context tied to the snapshot revision.
   * @throws {SelectionContextExpansionError} when the snapshot or capability is unavailable.
   */
  expand(snapshotId: string, scope: ContextScope): SelectionContextExpansion {
    const snapshot = this.cache.get(snapshotId)
    if (snapshot === undefined) {
      throw new SelectionContextExpansionError(
        `selection snapshot "${snapshotId}" is no longer available`,
        'SNAPSHOT_NOT_FOUND',
      )
    }
    return expandSelectionSnapshot(snapshot, scope, this.expansionOptions)
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
