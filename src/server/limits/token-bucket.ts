/**
 * Below this, a shortfall is floating-point noise, not a missing token: a
 * refill of 200 ms at 20 tokens per 4 s must make exactly one token.
 */
const EPSILON = 1e-9;

/**
 * A token bucket (#16). It holds up to `capacity` tokens and refills
 * continuously, `capacity` tokens per `windowMs`, so one number is both the
 * burst and the steady rate. Pure: the caller passes the time, so tests drive
 * it with a fake clock, and it has no timers, so an idle one costs nothing.
 *
 * A clock that goes backwards refills nothing: time has to pass the latest
 * reading again before tokens come back.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.at = now;
  }

  /** Takes one token if there is one. */
  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1 - EPSILON) return false;
    this.tokens = Math.max(0, this.tokens - 1);
    return true;
  }

  /** Back at capacity: nothing to remember, so it can be swept. */
  isFull(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.capacity - EPSILON;
  }

  /** Milliseconds until one token is available; 0 if one is now. */
  retryAfterMs(now: number): number {
    this.refill(now);
    if (this.tokens >= 1 - EPSILON) return 0;
    return Math.ceil(((1 - this.tokens) * this.windowMs) / this.capacity);
  }

  private refill(now: number): void {
    if (now <= this.at) return;
    // Multiply before dividing, so a whole token's worth of time gives
    // exactly one token.
    const earned = ((now - this.at) * this.capacity) / this.windowMs;
    this.tokens = Math.min(this.capacity, this.tokens + earned);
    this.at = now;
  }
}
