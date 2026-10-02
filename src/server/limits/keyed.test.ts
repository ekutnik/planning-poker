import { describe, expect, it } from "vitest";
import { KeyedLimiter, MAX_KEYS } from "./keyed.js";

describe("a keyed limiter", () => {
  it("gives each key its own bucket", () => {
    const limiter = new KeyedLimiter(2, 60_000);
    expect(limiter.take("a", 0)).toBe("ok");
    expect(limiter.take("a", 0)).toBe("ok");
    expect(limiter.take("a", 0)).toBe("limited");
    expect(limiter.take("b", 0)).toBe("ok");
    expect(limiter.retryAfterMs("a", 0)).toBe(30_000);
    expect(limiter.retryAfterMs("b", 0)).toBe(0);
  });

  it("sweeps only buckets that are full again, and none that `keep` holds", () => {
    const limiter = new KeyedLimiter(2, 60_000);
    limiter.take("refilled", 0);
    limiter.take("busy", 50_000);
    limiter.take("kept", 0);
    limiter.sweep(60_000, (key) => key === "kept");
    // "refilled" is full again; "busy" is still refilling; "kept" is held.
    expect(limiter.size).toBe(2);
    expect(limiter.take("busy", 60_000)).toBe("ok");
    expect(limiter.take("busy", 60_000)).toBe("limited");
    // Without `keep`, every full bucket goes.
    limiter.sweep(10 * 60_000);
    expect(limiter.size).toBe(0);
  });

  it("holds at most 10,000 keys by default, refusing a new one when full", () => {
    expect(MAX_KEYS).toBe(10_000);
    const limiter = new KeyedLimiter(1, 60_000, 3);
    for (const key of ["a", "b", "c"]) expect(limiter.take(key, 0)).toBe("ok");
    expect(limiter.take("d", 0)).toBe("full");
    // A key already there still gets its answer.
    expect(limiter.take("a", 0)).toBe("limited");
    // Once a bucket has refilled and been swept, a newcomer fits.
    limiter.sweep(60_000);
    expect(limiter.take("d", 60_000)).toBe("ok");
  });
});
