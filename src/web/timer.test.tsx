import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSnapshot, TimerView } from "../shared/snapshot.js";
import { phaseAnnouncement } from "./announce.js";
import { RoomView } from "./RoomView.js";
import { TimerControls, TimerReadout } from "./Timer.js";
import type { Tools } from "./tools.js";

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
  it("idle: one block, a clock, the duration (one minute by default) and Start", () => {
    const html = controls(IDLE);
    expect(html).toMatch(/^<div class="timer"><div class="timer-block"><svg/);
    // The select is named Timer; Start is a square play button that names
    // itself.
    expect(html).toMatch(/<select aria-label="Timer"/);
    expect(html).toMatch(/<option value="60000" selected="">1 min<\/option>/);
    for (const label of ["30 s", "2 min", "3 min", "5 min", "Custom…"]) {
      expect(html).toContain(`>${label}</option>`);
    }
    expect(buttons(html)).toEqual([
      '<button type="button" class="small-button small-button--icon" aria-label="Start the timer">',
    ]);
    expect(html).not.toContain("timer-edge");
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

  it("running: what is left, Pause and +30 s, named for a screen reader, and the edge", () => {
    const html = controls(running());
    expect(html).toContain(
      '<span class="timer-time">1:24</span><span class="visually-hidden"> left</span>',
    );
    expect(buttons(html)).toEqual([
      '<button type="button" class="small-button small-button--icon" aria-label="Pause the timer">',
      '<button type="button" class="small-button" aria-label="Add 30 seconds">',
    ]);
    // What is left is the block's own bottom edge: 84 of 60 s, so all of it.
    expect(html).toMatch(
      /<span class="timer-edge" aria-hidden="true" style="inline-size:100%"><\/span><\/div>/,
    );
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

describe("everyone else's block", () => {
  const readout = (timer: TimerView) =>
    renderToStaticMarkup(<TimerReadout timer={timer} />);

  it("shows nothing at all while idle", () => {
    expect(readout(IDLE)).toBe("");
  });

  it("running: the time, then what happens when it ends, with the edge", () => {
    const html = readout(running());
    expect(html).toContain(
      '<span class="timer-time">1:24</span> <span class="timer-word">left, then votes are revealed</span>',
    );
    expect(html).toContain('class="timer-edge"');
  });

  it("paused: the time, quiet, and Paused", () => {
    expect(readout(paused)).toContain(
      '<span class="timer-time timer-time--paused">1:24</span> <span class="timer-word">Paused</span>',
    );
  });

  it("has no controls", () => {
    expect(readout(running())).not.toContain("<button");
  });
});

describe("the timer in the room", () => {
  const snapshot = (timer: TimerView): RoomSnapshot => ({
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
  const ON: Tools = { ticket: false, timer: true };
  const OFF: Tools = { ticket: false, timer: false };
  const room = (timer: TimerView, facilitating: boolean, tools = ON) =>
    renderToStaticMarkup(
      <RoomView
        snapshot={snapshot(timer)}
        facilitating={facilitating}
        live
        banner={null}
        notice={null}
        persistent
        tools={tools}
        onAction={() => undefined}
      />,
    );

  it("leaves a participant's screen exactly as before while idle, whatever their settings", () => {
    const html = room(IDLE, false);
    expect(html).not.toContain("timer");
    expect(html).toContain(
      '<div class="round round--voting round--participant">',
    );
  });

  it("shows a participant a timer that runs or is paused, whatever their settings", () => {
    for (const tools of [ON, OFF]) {
      expect(room(running(), false, tools)).toContain(
        'class="timer timer--readout"',
      );
      expect(room(paused, false, tools)).toContain("timer--readout");
    }
  });

  it("gives the facilitator its controls only with Timer on", () => {
    expect(room(IDLE, true)).toContain('aria-label="Start the timer"');
    expect(room(IDLE, true, OFF)).not.toContain("timer");
    // Off, someone else's timer still shows, read only.
    expect(room(running(), true, OFF)).toContain("timer--readout");
    expect(room(running(), true, OFF)).not.toContain("Pause the timer");
  });

  it("comes after the ticket and before the round, Reveal votes still last", () => {
    const html = room(IDLE, true, { ticket: true, timer: true });
    const timer = html.indexOf('class="timer"');
    expect(timer).toBeGreaterThan(html.indexOf('class="ticket"'));
    expect(timer).toBeLessThan(html.indexOf("<h1"));
    expect(html.lastIndexOf("<button")).toBeGreaterThan(
      html.indexOf('class="controls"'),
    );
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
