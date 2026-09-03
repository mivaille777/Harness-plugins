import { IpcProtocolError } from './protocol.js'

export const DEFAULT_IPC_REQUEST_TIMEOUT_MS = 30_000

export interface PendingRequestTrackerOptions {
  readonly timeoutMs?: number
  readonly now?: () => number
}

/**
 * Deterministic request-id lifecycle tracker shared by future IPC transports.
 * It owns no timers: callers invoke expire() from their transport heartbeat.
 */
export class PendingRequestTracker {
  private readonly pending = new Map<string, number>()
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(options: PendingRequestTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_IPC_REQUEST_TIMEOUT_MS
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('timeoutMs must be a positive safe integer')
    }
  }

  begin(id: string): void {
    if (id.length === 0 || id.length > 128) {
      throw new IpcProtocolError('INVALID_MESSAGE', 'request id must contain 1-128 characters')
    }
    if (this.pending.has(id)) {
      throw new IpcProtocolError('DUPLICATE_REQUEST_ID', `request id is already pending: ${id}`)
    }
    this.pending.set(id, this.now() + this.timeoutMs)
  }

  complete(id: string): boolean {
    return this.pending.delete(id)
  }

  expire(now = this.now()): readonly string[] {
    const expired: string[] = []
    for (const [id, deadline] of this.pending) {
      if (deadline > now) continue
      this.pending.delete(id)
      expired.push(id)
    }
    return expired
  }

  /** Clear all in-flight identities after disconnect, reconnect, or Harness restart. */
  reset(): readonly string[] {
    const abandoned = [...this.pending.keys()]
    this.pending.clear()
    return abandoned
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  get size(): number {
    return this.pending.size
  }
}
