import { describe, expect, it } from "vitest";
import type { RoomSnapshot, TimerView } from "../shared/snapshot.js";
import {
  durationWords,
  formatClock,
  inLocalTime,
  parseClock,
  presetLabel,
  remainingMs,
  tenSecondsWait,
} from "./countdown.js";

/** The timer's arithmetic in the browser (ADR 0008). */

const running = (endsAt: number): TimerView => ({
  durationMs: 60_000,
  state: "running",
  endsAt,
  remainingMs: null,
});

const snapshot = (timer: TimerView): RoomSnapshot => ({
  phase: "voting",
  roomId: "abcdefghijk",
  version: 1,
  viewerId: "me",
  ticket: null,
  scores: null,
  timer,
  yourVote: null,
  participants: [],
});

describe("inLocalTime: the deadline in this browser's clock", () => {
  const local = 1_000_000;

  it.each([
    ["ten minutes ahead", 600_000],
    ["ten minutes behind", -600_000],
    ["the same", 0],
  ])("counts down the same minute when the server's clock is %s", (_, skew) => {
    const serverNow = local + skew;
    const moved = inLocalTime(
      snapshot(running(serverNow + 60_000)),
      serverNow,
      local,
    );
    expect(moved.timer.endsAt).toBe(local + 60_000);
  });

  it("leaves a snapshot with no deadline as it is", () => {
    const idle = snapshot({ ...running(0), state: "idle", endsAt: null });
    expect(inLocalTime(idle, 5, 9)).toBe(idle);
  });
});

describe("remainingMs", () => {
  it("counts down while running, never below 0", () => {
    expect(remainingMs(running(10_000), 4_000)).toBe(6_000);
    expect(remainingMs(running(10_000), 12_000)).toBe(0);
  });

  it("holds while paused, and is null while idle", () => {
    const paused: TimerView = {
      ...running(0),
      state: "paused",
      endsAt: null,
      remainingMs: 42_000,
    };
    expect(remainingMs(paused, 99_999)).toBe(42_000);
    expect(
      remainingMs({ ...paused, state: "idle", remainingMs: null }, 0),
    ).toBeNull();
  });
});

describe("formatClock", () => {
  it.each([
    [84_300, "1:25"],
    [84_000, "1:24"],
    [60_000, "1:00"],
    [9_001, "0:10"],
    [1, "0:01"],
    [0, "0:00"],
    [600_000, "10:00"],
  ])("%i ms is %s: rounded up, so 0:00 only at the end", (ms, clock) => {
    expect(formatClock(ms)).toBe(clock);
  });
});

describe("parseClock", () => {
  it.each([
    ["1:30", 90_000],
    ["0:45", 45_000],
    [" 0:10 ", 10_000],
    ["10:00", 600_000],
    ["2", 120_000],
  ])("reads %j as %i ms", (text, ms) => {
    expect(parseClock(text)).toBe(ms);
  });

  it.each(["", "abc", "1:5", "1:60", "1:30:00", "-1", "1.5"])(
    "refuses %j",
    (text) => {
      expect(parseClock(text)).toBeNull();
    },
  );
});

describe("the words for a screen reader, and the presets' labels", () => {
  it.each([
    [1_000, "1 second"],
    [10_000, "10 seconds"],
    [60_000, "1 minute"],
    [90_000, "1 minute 30 seconds"],
    [120_000, "2 minutes"],
  ])("%i ms is %j", (ms, words) => {
    expect(durationWords(ms)).toBe(words);
  });

  it.each([
    [30_000, "30 s"],
    [60_000, "1 min"],
    [300_000, "5 min"],
  ])("preset %i ms is %j", (ms, label) => {
    expect(presetLabel(ms)).toBe(label);
  });
});

describe("tenSecondsWait", () => {
  it("says it once 10 s are left, when more than that are left now", () => {
    expect(tenSecondsWait(70_000, 10_000)).toBe(50_000);
  });

  it.each([
    ["a 10 s timer", 20_000, 10_000],
    ["less than 10 s left", 15_000, 10_000],
  ])("stays quiet for %s", (_, endsAt, now) => {
    expect(tenSecondsWait(endsAt, now)).toBeNull();
  });
});
