/** Each capped line goes out at most this often across the whole server. */
export const LOG_LINES_PER_MINUTE = 10;
const MINUTE = 60_000;

/**
 * A cap on one kind of log line, for the whole server, not per connection
 * (#16): a per-connection cap bounds nothing when every bad frame comes on a
 * fresh connection, as an oversized frame does, since it closes its own.
 *
 * A fixed window, not a token bucket: up to `perMinute` lines go out in the
 * minute from the first one, then none until that minute ends, when the
 * ones held back are reported once, as a single line. A bucket would let
 * twice as many through in a minute (its burst, then its refill), and "at
 * most 10 a minute" should mean that. Pure: the caller passes the time.
 */
export class LogCap {
  private windowStart: number | null = null;
  private written = 0;
  private dropped = 0;

  constructor(private readonly perMinute = LOG_LINES_PER_MINUTE) {}

  /** Whether a line may go out now; if not, it is counted as suppressed. */
  allow(now: number): boolean {
    if (this.windowStart === null || now - this.windowStart >= MINUTE) {
      // A new minute; whatever the last one held back stays until reported.
      if (this.dropped === 0) {
        this.windowStart = now;
        this.written = 0;
      }
    }
    if (this.written < this.perMinute) {
      this.written += 1;
      return true;
    }
    this.dropped += 1;
    return false;
  }

  /**
   * How many lines were held back, once their minute has ended; null until
   * then, or if there were none. Reporting starts the next minute.
   */
  suppressed(now: number): number | null {
    if (
      this.dropped === 0 ||
      this.windowStart === null ||
      now - this.windowStart < MINUTE
    ) {
      return null;
    }
    const count = this.dropped;
    this.dropped = 0;
    this.windowStart = now;
    this.written = 0;
    return count;
  }
}

/**
 * The capped lines: the oversized-frame warning, the limits' own, and a
 * socket dropped for not reading.
 */
export const CAPPED_LINES = [
  "websocket error",
  "rate-limited",
  "strikes",
  "slow consumer",
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
