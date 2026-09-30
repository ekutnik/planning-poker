import type { RoomSnapshot, TimerView } from "../shared/snapshot.js";

/**
 * The timer in the browser (ADR 0008). The server holds the deadline in its
 * own clock; each snapshot comes with the server's clock reading, so on
 * arrival the deadline is moved into this browser's clock, and from then on
 * everything here compares with Date.now(). A browser whose clock is off by
 * minutes still counts down to the same moment as everyone else.
 */
export function inLocalTime(
  snapshot: RoomSnapshot,
  serverNow: number,
  localNow: number,
): RoomSnapshot {
  const { endsAt } = snapshot.timer;
  if (endsAt === null) return snapshot;
  return {
    ...snapshot,
    timer: { ...snapshot.timer, endsAt: endsAt - serverNow + localNow },
  };
}

/** What is left, in ms: counting down while running, held while paused, null while idle. */
export function remainingMs(timer: TimerView, now: number): number | null {
  if (timer.state === "running" && timer.endsAt !== null) {
    return Math.max(0, timer.endsAt - now);
  }
  if (timer.state === "paused") return timer.remainingMs;
  return null;
}

/** "1:24": minutes and seconds, rounded up, so 0:00 shows only at the end. */
export function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1_000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A custom duration as typed: "1:30", "0:45" or a whole number of minutes
 * ("2"). Null for anything else; the range is the caller's check.
 */
export function parseClock(text: string): number | null {
  const match = /^\s*(\d{1,2})(?::([0-5]\d))?\s*$/.exec(text);
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2] ?? 0)) * 1_000;
}

/** "1 minute", "30 seconds", "1 minute 30 seconds": for a screen reader. */
export function durationWords(ms: number): string {
  const seconds = Math.round(ms / 1_000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (minutes > 0)
    parts.push(minutes === 1 ? "1 minute" : `${String(minutes)} minutes`);
  if (rest > 0 || minutes === 0)
    parts.push(rest === 1 ? "1 second" : `${String(rest)} seconds`);
  return parts.join(" ");
}

/** A preset's label in the select: "30 s", "1 min". */
export function presetLabel(ms: number): string {
  return ms < 60_000 ? `${String(ms / 1_000)} s` : `${String(ms / 60_000)} min`;
}

/**
 * How long until "10 seconds left." should be said for a timer that ends at
 * `endsAt`, or null for not at all: only when more than 10 s are left now.
 * With 10 s or less (a 10 s timer, a resume near the end), it would talk
 * over "Timer started", or come too late to help.
 */
export function tenSecondsWait(endsAt: number, now: number): number | null {
  const wait = endsAt - 10_000 - now;
  return wait > 0 ? wait : null;
}
