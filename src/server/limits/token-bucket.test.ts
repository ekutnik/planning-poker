import { describe, expect, it } from "vitest";
import { TokenBucket } from "./token-bucket.js";

/** Takes until refused; how many it got. */
function drain(bucket: TokenBucket, now: number): number {
  let taken = 0;
  while (bucket.take(now)) taken += 1;
  return taken;
}

describe("a token bucket", () => {
  it("starts full: the capacity is the burst", () => {
    const bucket = new TokenBucket(20, 4_000, 0);
    expect(bucket.isFull(0)).toBe(true);
    expect(drain(bucket, 0)).toBe(20);
    expect(bucket.take(0)).toBe(false);
  });

  it("refills evenly, the capacity per window: 20 per 4 s is one every 200 ms", () => {
    const bucket = new TokenBucket(20, 4_000, 0);
    drain(bucket, 0);
    expect(bucket.take(199)).toBe(false);
    expect(bucket.take(200)).toBe(true);
    expect(bucket.take(200)).toBe(false);
    expect(drain(bucket, 1_200)).toBe(5);
  });

  it("adds fractional time up: two half-tokens make one", () => {
    const bucket = new TokenBucket(1, 1_000, 0);
    expect(bucket.take(0)).toBe(true);
    expect(bucket.take(500)).toBe(false);
    expect(bucket.take(1_000)).toBe(true);
    const thirds = new TokenBucket(3, 1_000, 0);
    drain(thirds, 0);
    expect(thirds.take(111)).toBe(false);
    expect(thirds.take(222)).toBe(false);
    expect(thirds.take(334)).toBe(true);
  });

  it("never holds more than its capacity, however long it waits", () => {
    const bucket = new TokenBucket(5, 25_000, 0);
    drain(bucket, 0);
    expect(drain(bucket, 10 * 60_000)).toBe(5);
  });

  it("refills nothing when the clock goes backwards", () => {
    const bucket = new TokenBucket(5, 5_000, 10_000);
    drain(bucket, 10_000);
    expect(bucket.take(4_000)).toBe(false);
    expect(bucket.isFull(0)).toBe(false);
    // Time must pass the latest reading again before tokens come back.
    expect(bucket.take(10_500)).toBe(false);
    expect(bucket.take(11_000)).toBe(true);
  });

  it("says how long until the next token", () => {
    const bucket = new TokenBucket(10, 60 * 60_000, 0); // 10 an hour
    expect(bucket.retryAfterMs(0)).toBe(0);
    drain(bucket, 0);
    expect(bucket.retryAfterMs(0)).toBe(6 * 60_000);
    expect(bucket.retryAfterMs(60_000)).toBe(5 * 60_000);
    expect(bucket.retryAfterMs(6 * 60_000)).toBe(0);
  });

  it("is full again once it has refilled, so it can be swept", () => {
    const bucket = new TokenBucket(60, 60_000, 0);
    bucket.take(0);
    expect(bucket.isFull(500)).toBe(false);
    expect(bucket.isFull(1_000)).toBe(true);
  });
});
