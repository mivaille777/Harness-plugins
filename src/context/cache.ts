import { normalizeSelectionSnapshot, type SelectionSnapshot } from './snapshot.js'

export const DEFAULT_SELECTION_TTL_MS = 5 * 60_000
export const DEFAULT_MAX_SNAPSHOTS = 64

export interface SelectionSnapshotCacheOptions {
  readonly ttlMs?: number
  readonly maxSnapshots?: number
  readonly now?: () => number
}

export type SelectionSnapshotUpdateResult =
  | { readonly accepted: true; readonly snapshot: SelectionSnapshot }
  | {
      readonly accepted: false
      readonly reason: 'stale-revision'
      readonly snapshot: SelectionSnapshot
    }

interface CacheRecord {
  readonly snapshot: SelectionSnapshot
  readonly expiresAt: number
}

/** In-memory, bounded cache for immutable selection snapshots. */
export class SelectionSnapshotCache {
  private readonly records = new Map<string, CacheRecord>()
  private readonly ttlMs: number
  private readonly maxSnapshots: number
  private readonly now: () => number
  private currentId: string | undefined

  constructor(options: SelectionSnapshotCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SELECTION_TTL_MS
    this.maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS
    this.now = options.now ?? Date.now

    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError('ttlMs must be a positive safe integer')
    }
    if (!Number.isSafeInteger(this.maxSnapshots) || this.maxSnapshots <= 0) {
      throw new RangeError('maxSnapshots must be a positive safe integer')
    }
  }

  update(input: SelectionSnapshot): SelectionSnapshotUpdateResult {
    const snapshot = normalizeSelectionSnapshot(input)
    const now = this.now()
    this.purgeExpired(now)

    const existing = this.records.get(snapshot.id)
    if (existing !== undefined && snapshot.revision <= existing.snapshot.revision) {
      return { accepted: false, reason: 'stale-revision', snapshot: existing.snapshot }
    }

    // Delete first so a higher revision becomes the newest cache entry for eviction order.
    this.records.delete(snapshot.id)
    this.records.set(snapshot.id, { snapshot, expiresAt: now + this.ttlMs })
    this.currentId = snapshot.id
    this.enforceLimit()

    return { accepted: true, snapshot }
  }

  current(): SelectionSnapshot | undefined {
    if (this.currentId === undefined) return undefined
    return this.get(this.currentId)
  }

  get(id: string): SelectionSnapshot | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined

    if (record.expiresAt <= this.now()) {
      this.records.delete(id)
      if (this.currentId === id) this.currentId = undefined
      return undefined
    }

    return record.snapshot
  }

  clear(id?: string): void {
    if (id === undefined) {
      this.records.clear()
      this.currentId = undefined
      return
    }

    this.records.delete(id)
    if (this.currentId === id) this.currentId = undefined
  }

  purgeExpired(now = this.now()): number {
    let removed = 0
    for (const [id, record] of this.records) {
      if (record.expiresAt > now) continue
      this.records.delete(id)
      if (this.currentId === id) this.currentId = undefined
      removed += 1
    }
    return removed
  }

  get size(): number {
    this.purgeExpired()
    return this.records.size
  }

  private enforceLimit(): void {
    while (this.records.size > this.maxSnapshots) {
      const oldestId = this.records.keys().next().value as string | undefined
      if (oldestId === undefined) return
      this.records.delete(oldestId)
      if (this.currentId === oldestId) this.currentId = undefined
    }
  }
}
