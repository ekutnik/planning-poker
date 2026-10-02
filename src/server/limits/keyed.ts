import { TokenBucket } from "./token-bucket.js";

/** At most this many keys in one table (ADR 0009). */
export const MAX_KEYS = 10_000;

/**
 * What a take answered: a token, none left for this key, or no room in the
 * table for a key it has not seen.
 */
export type Take = "ok" | "limited" | "full";

/**
 * One token bucket per key, such as a client address (#16). Its memory is
 * bounded: a bucket that has refilled to capacity remembers nothing worth
 * keeping, so the sweep drops it, and the table never holds more than
 * `maxKeys`. When it is full, a key it has not seen is refused, not let
 * through: filling 10,000 keys takes a distributed attack, which these
 * limits don't claim to stop (ADR 0009). Pure, like the bucket: the caller
 * passes the time.
 */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly maxKeys = MAX_KEYS,
  ) {}

  take(key: string, now: number): Take {
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      if (this.buckets.size >= this.maxKeys) return "full";
      bucket = new TokenBucket(this.capacity, this.windowMs, now);
      this.buckets.set(key, bucket);
    }
    return bucket.take(now) ? "ok" : "limited";
  }

  /** Milliseconds until `key` has a token again; 0 if it has one now. */
  retryAfterMs(key: string, now: number): number {
    return this.buckets.get(key)?.retryAfterMs(now) ?? 0;
  }

  /**
   * Drops every bucket that is full again, except those `keep` holds on to:
   * a key with sockets still open, say, whose count lives elsewhere.
   */
  sweep(now: number, keep: (key: string) => boolean = () => false): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.isFull(now) && !keep(key)) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
