import { TokenBucket } from "./token-bucket.js";

/** Each capped line goes out at most this often across the whole server. */
export const LOG_LINES_PER_MINUTE = 10;
const MINUTE = 60_000;

/**
 * A cap on one kind of log line, for the whole server, not per connection
 * (#16): a per-connection cap bounds nothing when every bad frame comes on a
 * fresh connection, as an oversized frame does, since it closes its own.
 * Up to LOG_LINES_PER_MINUTE lines a minute go out; past that, lines are
 * counted, not written, and once a minute has passed since the first one
 * dropped, the count is reported once, as a single line. Pure: the caller
 * passes the time.
 */
export class LogCap {
  private readonly bucket: TokenBucket;
  private dropped = 0;
  private firstDroppedAt = 0;

  constructor(perMinute = LOG_LINES_PER_MINUTE) {
    // It starts full, so the time it was made doesn't matter: no clock is
    // read before the first line.
    this.bucket = new TokenBucket(perMinute, MINUTE, 0);
  }

  /** Whether a line may go out now; if not, it is counted as suppressed. */
  allow(now: number): boolean {
    if (this.bucket.take(now)) return true;
    if (this.dropped === 0) this.firstDroppedAt = now;
    this.dropped += 1;
    return false;
  }

  /**
   * How many lines were suppressed, once a minute has passed since the first
   * of them; null until then, or if there were none. Reporting resets it.
   */
  suppressed(now: number): number | null {
    if (this.dropped === 0 || now - this.firstDroppedAt < MINUTE) return null;
    const count = this.dropped;
    this.dropped = 0;
    return count;
  }
}

/** The capped lines: the oversized-frame warning, and the limits' own. */
export const CAPPED_LINES = [
  "websocket error",
  "rate-limited",
  "strikes",
] as const;
export type CappedLine = (typeof CAPPED_LINES)[number];

/** One LogCap per capped line, shared by the app and the room service. */
export class LogCaps {
  private readonly caps: ReadonlyMap<CappedLine, LogCap>;

  constructor() {
    this.caps = new Map(CAPPED_LINES.map((line) => [line, new LogCap()]));
  }

  allow(line: CappedLine, now: number): boolean {
    return this.cap(line).allow(now);
  }

  /** The suppressed counts now due, one entry per line that has one. */
  due(now: number): { readonly line: CappedLine; readonly count: number }[] {
    const due = [];
    for (const line of CAPPED_LINES) {
      const count = this.cap(line).suppressed(now);
      if (count !== null) due.push({ line, count });
    }
    return due;
  }

  private cap(line: CappedLine): LogCap {
    const cap = this.caps.get(line);
    if (cap === undefined) throw new Error(`no cap for ${line}`);
    return cap;
  }
}
