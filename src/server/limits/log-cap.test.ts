import { describe, expect, it } from "vitest";
import { LogCap, LogCaps } from "./log-cap.js";

describe("a log cap", () => {
  it("lets 10 lines a minute out, then counts the rest", () => {
    const cap = new LogCap();
    const allowed = Array.from({ length: 25 }, () => cap.allow(1_000));
    expect(allowed.filter(Boolean)).toHaveLength(10);
    expect(allowed.slice(0, 10).every(Boolean)).toBe(true);
  });

  it("reports the suppressed count once, a minute after the first was dropped", () => {
    const cap = new LogCap();
    for (let i = 0; i < 25; i += 1) cap.allow(1_000);
    expect(cap.suppressed(1_000)).toBeNull();
    expect(cap.suppressed(60_999)).toBeNull();
    expect(cap.suppressed(61_000)).toBe(15);
    // Reported: nothing again until more are dropped.
    expect(cap.suppressed(200_000)).toBeNull();
  });

  it("means at most 10 in the minute, not 10 and then a refill (found by the flood check)", () => {
    const cap = new LogCap();
    for (let i = 0; i < 10; i += 1) expect(cap.allow(i * 1_000)).toBe(true);
    // Half a minute on, a bucket would have refilled 5; the window has not.
    for (let i = 0; i < 10; i += 1) expect(cap.allow(30_000)).toBe(false);
    expect(cap.allow(59_999)).toBe(false);
    expect(cap.suppressed(60_000)).toBe(11);
    expect(cap.allow(60_000)).toBe(true);
  });

  it("reports nothing when nothing was dropped", () => {
    const cap = new LogCap();
    cap.allow(0);
    expect(cap.suppressed(10 * 60_000)).toBeNull();
  });

  it("starts a new count after a report", () => {
    const cap = new LogCap();
    for (let i = 0; i < 12; i += 1) cap.allow(0); // 2 dropped at 0
    expect(cap.suppressed(60_000)).toBe(2);
    // The report started a new minute: 10 more go out, then 3 are dropped.
    for (let i = 0; i < 13; i += 1) cap.allow(60_000);
    expect(cap.suppressed(119_999)).toBeNull();
    expect(cap.suppressed(120_000)).toBe(3);
  });
});

describe("the server's log caps", () => {
  it("keeps one cap per line, so one flood doesn't silence another line", () => {
    const caps = new LogCaps();
    for (let i = 0; i < 30; i += 1) caps.allow("websocket error", 0);
    expect(caps.allow("rate-limited", 0)).toBe(true);
    expect(caps.allow("strikes", 0)).toBe(true);
    expect(caps.due(60_000)).toEqual([{ line: "websocket error", count: 20 }]);
  });
});
