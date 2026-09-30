import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSnapshot, TimerView } from "../shared/snapshot.js";
import { phaseAnnouncement } from "./announce.js";
import { TimerControls, TimerLine } from "./Timer.js";
import { VotingView } from "./VotingView.js";

/**
 * The timer on screen (ADR 0008). Its clicks, its countdown and what it says
 * are in the end-to-end suite (e2e/timer.e2e.ts); its arithmetic in
 * countdown.test.ts.
 */

const IDLE: TimerView = {
  durationMs: 60_000,
  state: "idle",
  endsAt: null,
  remainingMs: null,
};
const running = (): TimerView => ({
  ...IDLE,
  state: "running",
  endsAt: Date.now() + 84_000,
});
const paused: TimerView = { ...IDLE, state: "paused", remainingMs: 84_000 };

const controls = (timer: TimerView, live = true) =>
  renderToStaticMarkup(
    <TimerControls timer={timer} live={live} onAction={() => undefined} />,
  );
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);

describe("the facilitator's timer", () => {
  it("idle: a labelled duration, one minute by default, and Start", () => {
    const html = controls(IDLE);
    // One control named Timer: the select. Every button names itself.
    expect(html.match(/Timer</g)).toHaveLength(1);
    expect(html).toMatch(
      /<label for="([^"]+)" class="timer-label">Timer<\/label><select id="\1"/,
    );
    expect(html).toMatch(/<option value="60000" selected="">1 min<\/option>/);
    for (const label of ["30 s", "2 min", "3 min", "5 min", "Custom…"]) {
      expect(html).toContain(`>${label}</option>`);
    }
    expect(html).toMatch(
      /<button type="button" class="timer-button">Start<\/button>/,
    );
    expect(html).not.toContain("timer-bar");
  });

  it("idle with a duration that is no preset: Custom…, with its m:ss field", () => {
    const html = controls({ ...IDLE, durationMs: 45_000 });
    expect(html).toMatch(
      /<option value="custom" selected="">Custom…<\/option>/,
    );
    expect(html).toMatch(
      /<input[^>]*aria-label="Custom time"[^>]*value="0:45"/,
    );
  });

  it("running: what is left, Pause and +30 s, named for a screen reader, and the bar", () => {
    const html = controls(running());
    expect(html).toContain(
      '<span class="timer-time">1:24</span><span class="timer-word">left</span>',
    );
    expect(buttons(html)).toEqual([
      '<button type="button" class="timer-button" aria-label="Pause the timer">',
      '<button type="button" class="timer-button" aria-label="Add 30 seconds">',
    ]);
    expect(html).toContain('<div class="timer-bar" aria-hidden="true">');
  });

  it("paused: the time, quiet, with Paused, and Resume", () => {
    const html = controls(paused);
    expect(html).toContain(
      '<span class="timer-time timer-time--paused">1:24</span><span class="timer-word">Paused</span>',
    );
    expect(buttons(html)[0]).toContain('aria-label="Resume the timer"');
  });

  it("is disabled while the room reconnects", () => {
    for (const button of buttons(controls(running(), false))) {
      expect(button).toContain('disabled=""');
    }
    expect(controls(IDLE, false)).toMatch(/<select[^>]*disabled=""/);
  });
});

describe("everyone else's line", () => {
  const line = (timer: TimerView) =>
    renderToStaticMarkup(<TimerLine timer={timer} />);

  it("shows nothing at all while idle", () => {
    expect(line(IDLE)).toBe("");
  });

  it("running: the time, then what happens when it ends", () => {
    expect(line(running())).toContain(
      '<span class="timer-time">1:24</span> <span class="timer-word">left, then votes are revealed</span>',
    );
  });

  it("paused: Paused at the time", () => {
    expect(line(paused)).toContain(
      '<span class="timer-word">Paused at 1:24</span>',
    );
  });

  it("has no controls", () => {
    expect(line(running())).not.toContain("<button");
  });
});

describe("the timer in the voting screen", () => {
  const snapshot = (
    timer: TimerView,
  ): Extract<RoomSnapshot, { phase: "voting" }> => ({
    phase: "voting",
    roomId: "abcdefghijk",
    version: 3,
    viewerId: "ada",
    ticket: null,
    scores: null,
    timer,
    yourVote: null,
    participants: [
      { id: "ada", name: "Ada", status: "connected", hasVoted: false },
    ],
  });
  const view = (timer: TimerView, facilitating: boolean) =>
    renderToStaticMarkup(
      <VotingView
        snapshot={snapshot(timer)}
        facilitating={facilitating}
        live
        onAction={() => undefined}
      />,
    );

  it("leaves a participant's screen exactly as before while idle: no line, no row for it", () => {
    const html = view(IDLE, false);
    expect(html).not.toContain("timer");
    expect(html).toMatch(
      /^<div class="round round--voting round--participant">/,
    );
  });

  it("gives a participant's round its timer row only while it runs or is paused", () => {
    expect(view(running(), false)).toMatch(
      /^<div class="round round--voting round--participant round--timed">/,
    );
    expect(view(paused, false)).toContain("round--timed");
  });

  it("puts the facilitator's timer just before the round controls in keyboard order", () => {
    const html = view(IDLE, true);
    const timer = html.indexOf('class="timer"');
    expect(timer).toBeGreaterThan(html.indexOf('role="toolbar"'));
    expect(timer).toBeLessThan(html.indexOf('class="controls"'));
  });
});

describe("the reveal, said", () => {
  it("says Time's up when the timer revealed the round, and not otherwise", () => {
    const revealed = (revealCause: "timer" | null): RoomSnapshot => ({
      phase: "revealed",
      roomId: "abcdefghijk",
      version: 4,
      viewerId: "ada",
      ticket: null,
      scores: null,
      timer: IDLE,
      revealCause,
      participants: [
        { id: "ada", name: "Ada", status: "connected", vote: "5" },
        { id: "ben", name: "Ben", status: "connected", vote: "5" },
      ],
      results: {
        voteCount: 2,
        distribution: [{ card: "5", count: 2 }],
        consensus: true,
        min: "5",
        max: "5",
        spreadSteps: 0,
        winners: ["5"],
      },
    });
    const byTimer = phaseAnnouncement("voting", revealed("timer"));
    const byPerson = phaseAnnouncement("voting", revealed(null));
    expect(byTimer?.full).toBe(`Time's up. ${byPerson?.full ?? ""}`);
    expect(byTimer?.full).toMatch(/^Time's up\. Votes revealed\./);
    expect(byTimer?.afterHeading).toBe(
      `Time's up. ${byPerson?.afterHeading ?? ""}`,
    );
  });
});
