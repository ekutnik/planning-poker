import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createRoom,
  DISCONNECT_GRACE_MS,
  MAX_NAME_LENGTH,
  MAX_PARTICIPANTS,
  type Command,
  type Result,
  type Room,
} from "./room.js";
import type { Card } from "../../shared/deck.js";
import { computeResults } from "./results.js";

const NOW = 1_000;

function must(result: Result): Room {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error}`);
  return result.room;
}

function run(room: Room, ...commands: Command[]): Room {
  return runAt(NOW, room, ...commands);
}

function runAt(now: number, room: Room, ...commands: Command[]): Room {
  return commands.reduce(
    (current, command) => must(applyCommand(current, command, now)),
    room,
  );
}

const join = (
  participantId: string,
  name: string = participantId,
): Command => ({
  type: "join",
  participantId,
  name,
});
const castVote = (participantId: string, card: Card): Command => ({
  type: "castVote",
  participantId,
  card,
});
const clearVote = (participantId: string): Command => ({
  type: "clearVote",
  participantId,
});
const reveal = (participantId: string): Command => ({
  type: "reveal",
  participantId,
});
const reset = (participantId: string): Command => ({
  type: "reset",
  participantId,
});
const disconnect = (participantId: string): Command => ({
  type: "disconnect",
  participantId,
});
const leave = (participantId: string): Command => ({
  type: "leave",
  participantId,
});
const expire = (participantId: string): Command => ({
  type: "expire",
  participantId,
});

describe("join", () => {
  it("adds a new participant, connected and without a vote", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(room.participants.get("alice")).toEqual({
      id: "alice",
      name: "alice",
      vote: null,
      status: "connected",
      disconnectedAt: null,
    });
    expect(room.version).toBe(1);
  });

  it("trims names and rejects empty or over-long ones", () => {
    const room = createRoom("r1");
    expect(
      must(applyCommand(room, join("a", "  Alice  "), NOW)).participants.get(
        "a",
      )?.name,
    ).toBe("Alice");
    expect(applyCommand(room, join("a", "   "), NOW)).toEqual({
      ok: false,
      error: "INVALID_NAME",
    });
    expect(
      applyCommand(room, join("a", "x".repeat(MAX_NAME_LENGTH + 1)), NOW),
    ).toEqual({
      ok: false,
      error: "INVALID_NAME",
    });
  });

  it("collapses internal runs of whitespace in names", () => {
    const room = createRoom("r1");
    const named = must(
      applyCommand(room, join("a", "  Alice\t\n  Smith  "), NOW),
    );
    expect(named.participants.get("a")?.name).toBe("Alice Smith");
  });

  it("reclaims an existing seat on rejoin, keeping the vote", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      disconnect("alice"),
      join("alice", "Alice"),
    );
    expect(room.participants.get("alice")).toMatchObject({
      name: "Alice",
      vote: "5",
      status: "connected",
      disconnectedAt: null,
    });
  });

  it("rejects a new participant when the room is full, but lets an existing one rejoin", () => {
    const full = run(
      createRoom("r1"),
      ...Array.from({ length: MAX_PARTICIPANTS }, (_, i) => join(`p${i}`)),
    );
    expect(applyCommand(full, join("newcomer"), NOW)).toEqual({
      ok: false,
      error: "ROOM_FULL",
    });
    expect(applyCommand(full, join("p0", "Renamed"), NOW).ok).toBe(true);
  });

  it("returns the same room when a rejoin changes nothing", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(must(applyCommand(room, join("alice"), NOW))).toBe(room);
  });

  it("never mutates the input room", () => {
    const room = run(createRoom("r1"), join("alice"));
    const before = structuredClone(room);
    applyCommand(room, join("bob"), NOW);
    expect(room).toEqual(before);
  });
});

describe("castVote", () => {
  it("sets the vote", () => {
    const room = run(createRoom("r1"), join("alice"), castVote("alice", "5"));
    expect(room.participants.get("alice")?.vote).toBe("5");
    expect(room.version).toBe(2);
  });

  it("replaces the vote when you change it", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      castVote("alice", "8"),
    );
    expect(room.participants.get("alice")?.vote).toBe("8");
  });

  it("is a no-op when re-casting the same card", () => {
    const room = run(createRoom("r1"), join("alice"), castVote("alice", "5"));
    expect(must(applyCommand(room, castVote("alice", "5"), NOW))).toBe(room);
  });

  it("is a no-op when re-casting the same card after reveal (safe reconnect retry)", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      reveal("alice"),
    );
    expect(must(applyCommand(room, castVote("alice", "5"), NOW))).toBe(room);
  });

  it("rejects a vote from an unknown participant", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(applyCommand(room, castVote("ghost", "5"), NOW)).toEqual({
      ok: false,
      error: "UNKNOWN_PARTICIPANT",
    });
  });

  it("rejects a vote from a disconnected participant", () => {
    const room = run(createRoom("r1"), join("alice"), disconnect("alice"));
    expect(applyCommand(room, castVote("alice", "5"), NOW)).toEqual({
      ok: false,
      error: "NOT_CONNECTED",
    });
  });

  it("rejects a different vote that arrives after reveal", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      reveal("alice"),
    );
    expect(applyCommand(room, castVote("alice", "8"), NOW)).toEqual({
      ok: false,
      error: "VOTING_CLOSED",
    });
  });
});

describe("clearVote", () => {
  it("clears the vote", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      clearVote("alice"),
    );
    expect(room.participants.get("alice")?.vote).toBeNull();
  });

  it("is a no-op when the vote is already null", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(must(applyCommand(room, clearVote("alice"), NOW))).toBe(room);
  });

  it("is a no-op when clearing an already-empty vote after reveal", () => {
    // alice's vote lets the room reveal; bob never voted, so clearing his empty
    // vote is a no-op even in the revealed phase (end state already holds).
    const room = run(
      createRoom("r1"),
      join("alice"),
      join("bob"),
      castVote("alice", "5"),
      reveal("alice"),
    );
    expect(must(applyCommand(room, clearVote("bob"), NOW))).toBe(room);
  });

  it("rejects clearing from a disconnected participant", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      disconnect("alice"),
    );
    expect(applyCommand(room, clearVote("alice"), NOW)).toEqual({
      ok: false,
      error: "NOT_CONNECTED",
    });
  });

  it("rejects clearing a vote after reveal", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      reveal("alice"),
    );
    expect(applyCommand(room, clearVote("alice"), NOW)).toEqual({
      ok: false,
      error: "VOTING_CLOSED",
    });
  });

  it("rejects clearing for an unknown participant", () => {
    const room = createRoom("r1");
    expect(applyCommand(room, clearVote("ghost"), NOW)).toEqual({
      ok: false,
      error: "UNKNOWN_PARTICIPANT",
    });
  });
});

describe("reveal", () => {
  it("moves the room to revealed", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      reveal("alice"),
    );
    expect(room.phase).toBe("revealed");
  });

  it("rejects reveal when nobody has voted", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(applyCommand(room, reveal("alice"), NOW)).toEqual({
      ok: false,
      error: "NO_VOTES_CAST",
    });
  });

  it("counts ? and ☕ as votes", () => {
    const question = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "?"),
    );
    expect(must(applyCommand(question, reveal("alice"), NOW)).phase).toBe(
      "revealed",
    );
    const coffee = run(createRoom("r2"), join("bob"), castVote("bob", "☕"));
    expect(must(applyCommand(coffee, reveal("bob"), NOW)).phase).toBe(
      "revealed",
    );
  });

  it("is a no-op on a second, simultaneous reveal", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      reveal("alice"),
    );
    expect(must(applyCommand(room, reveal("alice"), NOW))).toBe(room);
  });

  it("rejects reveal from an unknown participant", () => {
    const room = run(createRoom("r1"), join("alice"), castVote("alice", "5"));
    expect(applyCommand(room, reveal("ghost"), NOW)).toEqual({
      ok: false,
      error: "UNKNOWN_PARTICIPANT",
    });
  });

  it("rejects reveal from a disconnected participant", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      disconnect("alice"),
    );
    expect(applyCommand(room, reveal("alice"), NOW)).toEqual({
      ok: false,
      error: "NOT_CONNECTED",
    });
  });
});

describe("reset", () => {
  it("clears all votes and returns to voting", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      join("bob"),
      castVote("alice", "5"),
      castVote("bob", "8"),
      reveal("alice"),
      reset("alice"),
    );
    expect(room.phase).toBe("voting");
    expect(room.participants.get("alice")?.vote).toBeNull();
    expect(room.participants.get("bob")?.vote).toBeNull();
  });

  it("restarts the round mid-voting", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      reset("alice"),
    );
    expect(room.phase).toBe("voting");
    expect(room.participants.get("alice")?.vote).toBeNull();
  });

  it("is a no-op when already voting with no votes", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(must(applyCommand(room, reset("alice"), NOW))).toBe(room);
  });

  it("rejects reset from an unknown participant", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(applyCommand(room, reset("ghost"), NOW)).toEqual({
      ok: false,
      error: "UNKNOWN_PARTICIPANT",
    });
  });

  it("rejects reset from a disconnected participant", () => {
    const room = run(createRoom("r1"), join("alice"), disconnect("alice"));
    expect(applyCommand(room, reset("alice"), NOW)).toEqual({
      ok: false,
      error: "NOT_CONNECTED",
    });
  });
});

describe("disconnect", () => {
  it("marks the participant disconnected at now and keeps the vote", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      castVote("alice", "5"),
      disconnect("alice"),
    );
    expect(room.participants.get("alice")).toMatchObject({
      status: "disconnected",
      disconnectedAt: NOW,
      vote: "5",
    });
  });

  it("is a no-op for an unknown participant (disconnect after leave)", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(must(applyCommand(room, disconnect("ghost"), NOW))).toBe(room);
  });

  it("is a no-op on a repeated disconnect", () => {
    const room = run(createRoom("r1"), join("alice"), disconnect("alice"));
    expect(must(applyCommand(room, disconnect("alice"), NOW))).toBe(room);
  });
});

describe("leave", () => {
  it("removes the participant and their vote", () => {
    const room = run(
      createRoom("r1"),
      join("alice"),
      join("bob"),
      castVote("alice", "5"),
      leave("alice"),
    );
    expect(room.participants.has("alice")).toBe(false);
    expect(room.participants.has("bob")).toBe(true);
  });

  it("is a no-op for an unknown participant", () => {
    const room = run(createRoom("r1"), join("alice"));
    expect(must(applyCommand(room, leave("ghost"), NOW))).toBe(room);
  });
});

describe("expire", () => {
  // alice and bob voted; alice disconnected at NOW.
  const base = () =>
    run(
      createRoom("r1"),
      join("alice"),
      join("bob"),
      castVote("alice", "5"),
      castVote("bob", "8"),
      disconnect("alice"),
    );
  const graceOver = NOW + DISCONNECT_GRACE_MS;

  it("removes a participant, and their vote, once the grace period is over", () => {
    const room = runAt(graceOver, base(), expire("alice"));
    expect(room.participants.has("alice")).toBe(false);
    expect(room.participants.get("bob")?.vote).toBe("8");
  });

  it("is a no-op while the grace period is still running", () => {
    const room = base();
    expect(must(applyCommand(room, expire("alice"), graceOver - 1))).toBe(room);
  });

  it("is a no-op for a participant who reconnected, however late the sweep runs", () => {
    const room = run(base(), join("alice")); // reclaims the seat
    const later = graceOver * 10;
    expect(must(applyCommand(room, expire("alice"), later))).toBe(room);
    expect(room.participants.get("alice")?.vote).toBe("5");
  });

  it("is a no-op for a connected participant and for an unknown one", () => {
    const room = base();
    expect(must(applyCommand(room, expire("bob"), graceOver))).toBe(room);
    expect(must(applyCommand(room, expire("ghost"), graceOver))).toBe(room);
  });

  it("lets an expired participant rejoin only as someone new, with no vote", () => {
    const room = runAt(graceOver, base(), expire("alice"), join("alice"));
    expect(room.participants.get("alice")).toMatchObject({
      status: "connected",
      vote: null,
    });
  });

  it("is deterministic: the same room and time give the same result", () => {
    const room = base();
    expect(applyCommand(room, expire("alice"), graceOver)).toEqual(
      applyCommand(room, expire("alice"), graceOver),
    );
  });
});

describe("invariants", () => {
  // A realistic mixed scenario; each step is tagged with its expected outcome so
  // one loop can assert the version and immutability rules across all commands.
  type Outcome = "change" | "noop" | "reject";
  const scenario: readonly {
    readonly command: Command;
    readonly outcome: Outcome;
  }[] = [
    { command: join("alice"), outcome: "change" },
    { command: join("bob"), outcome: "change" },
    { command: castVote("alice", "5"), outcome: "change" },
    { command: castVote("alice", "5"), outcome: "noop" },
    { command: castVote("bob", "8"), outcome: "change" },
    { command: reveal("alice"), outcome: "change" },
    { command: reveal("bob"), outcome: "noop" },
    { command: castVote("alice", "3"), outcome: "reject" },
    { command: reset("alice"), outcome: "change" },
    { command: reset("alice"), outcome: "noop" },
    { command: disconnect("bob"), outcome: "change" },
    { command: disconnect("bob"), outcome: "noop" },
    // bob is disconnected: a stray command from a resurrected socket is rejected
    // (NOT_CONNECTED) before any phase/no-op logic runs.
    { command: castVote("bob", "5"), outcome: "reject" },
    // bob is still within the grace period at NOW, so expiry changes nothing.
    { command: expire("bob"), outcome: "noop" },
    // bob reclaims his seat: status and disconnectedAt must flip back together.
    { command: join("bob"), outcome: "change" },
    { command: leave("alice"), outcome: "change" },
    { command: leave("alice"), outcome: "noop" },
  ];

  it("bumps version by exactly 1 on a change, and leaves it unchanged on no-ops and rejects", () => {
    let room = createRoom("r1");
    for (const { command, outcome } of scenario) {
      const before = room.version;
      const result = applyCommand(room, command, NOW);
      if (outcome === "reject") {
        expect(result.ok).toBe(false);
        continue;
      }
      const next = must(result);
      if (outcome === "change") {
        expect(next.version).toBe(before + 1);
      } else {
        expect(next).toBe(room); // no-op returns the same reference
        expect(next.version).toBe(before);
      }
      room = next;
    }
  });

  it("keeps status and disconnectedAt in agreement at every step", () => {
    // Two fields encode one fact; expire reads one and the sweep filters on
    // the other, so any divergence would be silent. Check it everywhere.
    let room = createRoom("r1");
    for (const { command } of scenario) {
      const result = applyCommand(room, command, NOW);
      if (result.ok) room = result.room;
      for (const p of room.participants.values()) {
        expect(p.status === "disconnected").toBe(p.disconnectedAt !== null);
      }
    }
  });

  it("never mutates the input room at any step", () => {
    let room = createRoom("r1");
    for (const { command } of scenario) {
      const snapshot = structuredClone(room);
      const result = applyCommand(room, command, NOW);
      expect(room).toEqual(snapshot);
      if (result.ok) room = result.room;
    }
  });
});

describe("setTicket", () => {
  const setTicket = (participantId: string, text: string): Command => ({
    type: "setTicket",
    participantId,
    text,
  });
  const inRoom = () => run(createRoom("r1"), join("alice"), join("bob"));

  it("starts with no ticket", () => {
    expect(createRoom("r1").ticket).toBeNull();
  });

  it("sets the cleaned text, for the whole room", () => {
    const room = run(inRoom(), setTicket("alice", "  PROJ-482 \n Fix it "));
    expect(room.ticket).toBe("PROJ-482 Fix it");
  });

  it("accepts 120 characters after cleaning, and refuses 121", () => {
    const room = inRoom();
    expect(
      must(applyCommand(room, setTicket("alice", ` ${"x".repeat(120)} `), NOW))
        .ticket,
    ).toBe("x".repeat(120));
    expect(
      applyCommand(room, setTicket("alice", "x".repeat(121)), NOW),
    ).toEqual({ ok: false, error: "TICKET_TOO_LONG" });
  });

  it("clears it with empty text", () => {
    const room = run(
      inRoom(),
      setTicket("alice", "PROJ-1"),
      setTicket("bob", "  "),
    );
    expect(room.ticket).toBeNull();
  });

  it("is a no-op for the same text, before or after cleaning, and for clearing nothing", () => {
    const room = run(inRoom(), setTicket("alice", "PROJ-1"));
    for (const text of ["PROJ-1", "  PROJ-1 ", "PROJ-1\u0000"]) {
      const next = must(applyCommand(room, setTicket("bob", text), NOW));
      expect(next).toBe(room);
      expect(next.version).toBe(room.version);
    }
    const empty = inRoom();
    expect(must(applyCommand(empty, setTicket("alice", ""), NOW))).toBe(empty);
    // A control character between two spaces cleans to one space, so it is
    // the same ticket, not a new one with a double space.
    const words = run(inRoom(), setTicket("alice", "PROJ-1 Fix"));
    expect(
      must(applyCommand(words, setTicket("bob", "PROJ-1 \u0000 Fix"), NOW)),
    ).toBe(words);
  });

  it("bumps the version by one on a change", () => {
    const room = inRoom();
    expect(run(room, setTicket("alice", "PROJ-1")).version).toBe(
      room.version + 1,
    );
  });

  it("follows the order of checks: unknown, then not connected, then the rules", () => {
    const room = run(inRoom(), disconnect("bob"));
    expect(applyCommand(room, setTicket("zed", "x".repeat(121)), NOW)).toEqual({
      ok: false,
      error: "UNKNOWN_PARTICIPANT",
    });
    expect(applyCommand(room, setTicket("bob", "x".repeat(121)), NOW)).toEqual({
      ok: false,
      error: "NOT_CONNECTED",
    });
  });

  it("works in either phase, and stays across a reveal and Start next round", () => {
    const revealed = run(inRoom(), castVote("alice", "5"), reveal("alice"));
    const set = run(revealed, setTicket("bob", "PROJ-1"));
    expect(set.phase).toBe("revealed");
    expect(set.ticket).toBe("PROJ-1");
    const next = run(set, reset("alice"), castVote("bob", "3"), reveal("bob"));
    expect(next.ticket).toBe("PROJ-1");
  });

  it("changes nothing else in the room", () => {
    const room = run(inRoom(), castVote("alice", "5"));
    const { ticket, version, ...rest } = run(
      room,
      setTicket("alice", "PROJ-1"),
    );
    const { ticket: before, version: v, ...restBefore } = room;
    expect(rest).toEqual(restBefore);
    expect([before, ticket, version]).toEqual([null, "PROJ-1", v + 1]);
  });
});

describe("keeping score", () => {
  const setScoring = (participantId: string, on: boolean): Command => ({
    type: "setScoring",
    participantId,
    on,
  });
  const PEOPLE = ["a", "b", "c", "d", "e", "f"] as const;
  /** A room with everyone in it, scoring as given. */
  const room = (scoring: boolean) => {
    const joined = run(createRoom("r1"), ...PEOPLE.map((id) => join(id)));
    return scoring ? run(joined, setScoring("a", true)) : joined;
  };
  /** Votes by person, then a reveal. */
  const round = (start: Room, votes: Partial<Record<string, Card>>) =>
    run(
      start,
      ...Object.entries(votes).map(([id, card]) => castVote(id, card as Card)),
      reveal("a"),
    );
  const points = (r: Room) => Object.fromEntries(r.scores);

  it("is off in a new room, with no points", () => {
    expect(createRoom("r1").scoring).toBe(false);
    expect(createRoom("r1").scores.size).toBe(0);
  });

  it.each([
    [
      "one winning card: its voters get a point",
      { a: "5", b: "5", c: "8" },
      { a: 1, b: 1 },
    ],
    ["a draw: nobody", { a: "2", b: "3", c: "3", d: "5", e: "5", f: "8" }, {}],
    ["no result: nobody", { a: "3", b: "5" }, {}],
    [
      "? and ☕ never win, and never score",
      { a: "5", b: "5", c: "?", d: "☕" },
      { a: 1, b: 1 },
    ],
    [
      "everyone agrees: everyone scores",
      { a: "8", b: "8", c: "8" },
      { a: 1, b: 1, c: 1 },
    ],
  ] as const)("%s", (_, votes, expected) => {
    expect(points(round(room(true), votes))).toEqual(expected);
  });

  it("awards by the rule the result shows, so the two always agree", () => {
    // Five numeric votes: one at each end, a 3 and the 8, is set aside, so 5
    // wins with two. Counting without that step would call 3 and 5 a draw.
    const revealed = round(room(true), {
      a: "3",
      b: "3",
      c: "5",
      d: "5",
      e: "8",
    });
    expect(computeResults(revealed).winners).toEqual(["5"]);
    expect(points(revealed)).toEqual({ c: 1, d: 1 });
  });

  it("with scoring off, a reveal is exactly the reveal it was before scores existed", () => {
    const before = run(room(false), castVote("a", "5"), castVote("b", "5"));
    const after = must(applyCommand(before, reveal("a"), NOW));
    // Field by field: only the phase and the version change, as in v0.2.1;
    // the new fields are left as they were, the scores the very same map.
    expect(after).toEqual({
      ...before,
      phase: "revealed",
      version: before.version + 1,
    });
    expect(after.scores).toBe(before.scores);
    expect(after.scoring).toBe(false);
  });

  it("with scoring on, the reveal and its points are one change: the version goes up once", () => {
    const before = run(room(true), castVote("a", "5"), castVote("b", "5"));
    const after = must(applyCommand(before, reveal("a"), NOW));
    expect(after.version).toBe(before.version + 1);
    expect(points(after)).toEqual({ a: 1, b: 1 });
  });

  it("counts only from when it is turned on", () => {
    const first = round(room(false), { a: "5", b: "5" });
    expect(points(first)).toEqual({});
    const second = round(run(first, reset("a"), setScoring("b", true)), {
      a: "8",
      c: "8",
    });
    expect(points(second)).toEqual({ a: 1, c: 1 });
  });

  it("counts every reveal, including a second round on the same ticket", () => {
    const ticket: Command = {
      type: "setTicket",
      participantId: "a",
      text: "PROJ-1",
    };
    const first = round(run(room(true), ticket), { a: "5", b: "5" });
    const second = round(run(first, reset("a")), { a: "5", b: "5" });
    expect(second.ticket).toBe("PROJ-1");
    expect(points(second)).toEqual({ a: 2, b: 2 });
  });

  it("records points at the reveal and never recalculates them", () => {
    const revealed = round(room(true), { a: "5", b: "5", c: "8" });
    // b leaves: 5 would no longer win, but a keeps the point already won.
    const after = run(revealed, leave("b"), reset("a"));
    expect(points(after)).toEqual({ a: 1 });
  });

  it("a reveal by the timer (timeUp) awards points the same way", () => {
    const start: Command = { type: "timerStart", participantId: "a" };
    const running = run(
      room(true),
      castVote("a", "5"),
      castVote("b", "5"),
      start,
    );
    const endsAt = running.timer.endsAt ?? 0;
    const revealed = must(applyCommand(running, { type: "timeUp" }, endsAt));
    expect(revealed.phase).toBe("revealed");
    expect(revealed.revealCause).toBe("timer");
    expect(points(revealed)).toEqual({ a: 1, b: 1 });
  });

  describe("seats", () => {
    const scored = () => round(room(true), { a: "5", b: "5" });

    it("a reconnect within the grace period keeps the points", () => {
      const back = run(scored(), disconnect("b"), join("b"));
      expect(points(back)).toEqual({ a: 1, b: 1 });
    });

    it("someone removed loses them, by leaving or by the grace period ending", () => {
      expect(points(run(scored(), leave("b")))).toEqual({ a: 1 });
      const expired = runAt(
        NOW + DISCONNECT_GRACE_MS,
        run(scored(), disconnect("b")),
        expire("b"),
      );
      expect(points(expired)).toEqual({ a: 1 });
    });

    it("a newcomer, even with the same id as someone who left, starts at 0", () => {
      const rejoined = run(scored(), leave("b"), join("b"));
      expect(rejoined.scores.get("b")).toBeUndefined();
    });
  });

  describe("setScoring", () => {
    it("turning it off keeps the points; turning it on again brings them back", () => {
      const off = run(
        round(room(true), { a: "5", b: "5" }),
        setScoring("c", false),
      );
      expect(off.scoring).toBe(false);
      expect(points(off)).toEqual({ a: 1, b: 1 });
      expect(points(run(off, setScoring("d", true)))).toEqual({ a: 1, b: 1 });
    });

    it("off gives no points at a reveal", () => {
      const off = run(
        round(room(true), { a: "5", b: "5" }),
        reset("a"),
        setScoring("a", false),
      );
      expect(points(round(off, { a: "5", b: "5" }))).toEqual({ a: 1, b: 1 });
    });

    it("is a no-op when already so: the same room, the same version", () => {
      for (const on of [true, false]) {
        const r = room(on);
        expect(must(applyCommand(r, setScoring("b", on), NOW))).toBe(r);
      }
    });

    it("follows the order of checks: unknown, then not connected", () => {
      const r = run(room(false), disconnect("b"));
      expect(applyCommand(r, setScoring("zed", true), NOW)).toEqual({
        ok: false,
        error: "UNKNOWN_PARTICIPANT",
      });
      expect(applyCommand(r, setScoring("b", true), NOW)).toEqual({
        ok: false,
        error: "NOT_CONNECTED",
      });
    });
  });
});

describe("the timer", () => {
  const MIN = 60_000;
  const cmd = (type: string, participantId = "alice"): Command =>
    ({ type, participantId }) as Command;
  const setDuration = (ms: number): Command => ({
    type: "timerSetDuration",
    participantId: "alice",
    ms,
  });
  const inRoom = () => run(createRoom("r1"), join("alice"), join("bob"));
  const at = (now: number, r: Room, command: Command) =>
    must(applyCommand(r, command, now));
  const running = () => at(NOW, inRoom(), cmd("timerStart"));
  const paused = () => at(NOW + 20_000, running(), cmd("timerPause"));

  it("is idle in a new room, for a minute, with no deadline", () => {
    expect(createRoom("r1").timer).toEqual({
      durationMs: MIN,
      state: "idle",
      endsAt: null,
      remainingMs: null,
    });
    expect(createRoom("r1").revealCause).toBeNull();
  });

  describe("timerStart", () => {
    it("while voting and idle: the deadline is now plus the duration", () => {
      expect(running().timer).toEqual({
        durationMs: MIN,
        state: "running",
        endsAt: NOW + MIN,
        remainingMs: null,
      });
    });

    it.each([
      ["running", running],
      ["paused", paused],
    ])("is a no-op while %s", (_, timer) => {
      const r = timer();
      expect(at(NOW + 5_000, r, cmd("timerStart"))).toBe(r);
    });

    it("is refused once the votes are revealed", () => {
      const revealed = run(inRoom(), castVote("alice", "5"), reveal("alice"));
      expect(applyCommand(revealed, cmd("timerStart"), NOW)).toEqual({
        ok: false,
        error: "VOTING_CLOSED",
      });
    });
  });

  describe("timerPause and timerResume", () => {
    it("pause keeps what is left; resume sets a new deadline from it", () => {
      expect(paused().timer).toEqual({
        durationMs: MIN,
        state: "paused",
        endsAt: null,
        remainingMs: 40_000,
      });
      const resumed = at(NOW + 90_000, paused(), cmd("timerResume"));
      expect(resumed.timer).toEqual({
        durationMs: MIN,
        state: "running",
        endsAt: NOW + 90_000 + 40_000,
        remainingMs: null,
      });
    });

    it("a pause that arrives after the deadline keeps 0, not a negative time", () => {
      expect(
        at(NOW + MIN + 500, running(), cmd("timerPause")).timer.remainingMs,
      ).toBe(0);
    });

    it.each([
      ["pause while paused", paused, "timerPause"],
      ["pause while idle", inRoom, "timerPause"],
      ["resume while running", running, "timerResume"],
      ["resume while idle", inRoom, "timerResume"],
    ])(
      "%s is a no-op: it races the deadline, so it is not an error",
      (_, timer, type) => {
        const r = timer();
        expect(at(NOW + 1_000, r, cmd(type))).toBe(r);
      },
    );
  });

  describe("timerAdd", () => {
    it("adds 30 s to a running timer's deadline", () => {
      expect(at(NOW + 1_000, running(), cmd("timerAdd")).timer.endsAt).toBe(
        NOW + MIN + 30_000,
      );
    });

    it("adds 30 s to what a paused timer has left", () => {
      expect(
        at(NOW + 25_000, paused(), cmd("timerAdd")).timer.remainingMs,
      ).toBe(70_000);
    });

    it("never takes what is left past 10 minutes, and is a no-op at the cap", () => {
      const long = at(
        NOW,
        at(NOW, inRoom(), setDuration(10 * MIN)),
        cmd("timerStart"),
      );
      const later = NOW + 20_000;
      const added = at(later, long, cmd("timerAdd"));
      expect(added.timer.endsAt).toBe(later + 10 * MIN);
      expect(at(later, added, cmd("timerAdd"))).toBe(added);
    });

    it("is a no-op while idle", () => {
      const r = inRoom();
      expect(at(NOW, r, cmd("timerAdd"))).toBe(r);
    });
  });

  describe("timerSetDuration", () => {
    it.each([10_000, 30_000, 5 * MIN, 10 * MIN])("accepts %i ms", (ms) => {
      expect(at(NOW, inRoom(), setDuration(ms)).timer.durationMs).toBe(ms);
    });

    it.each([0, 9_000, 10 * MIN + 1_000, 30_500, 60_001])(
      "refuses %i ms: whole seconds from 10 s to 10 min only",
      (ms) => {
        expect(applyCommand(inRoom(), setDuration(ms), NOW)).toEqual({
          ok: false,
          error: "INVALID_DURATION",
        });
      },
    );

    it("is a no-op for the same duration", () => {
      const r = inRoom();
      expect(at(NOW, r, setDuration(MIN))).toBe(r);
    });

    it("leaves a running timer's deadline alone: the new length is for the next start", () => {
      const changed = at(NOW + 1_000, running(), setDuration(2 * MIN));
      expect(changed.timer).toMatchObject({
        durationMs: 2 * MIN,
        state: "running",
        endsAt: NOW + MIN,
      });
    });
  });

  describe("back to idle by itself", () => {
    it("at a reveal by a person, keeping the duration", () => {
      const r = run(running(), castVote("bob", "3"), reveal("alice"));
      expect(r.timer).toEqual({
        durationMs: MIN,
        state: "idle",
        endsAt: null,
        remainingMs: null,
      });
      expect(r.revealCause).toBeNull();
    });

    it("at Start next round, from running or paused", () => {
      for (const timer of [running, paused]) {
        const r = run(timer(), castVote("bob", "3"), reset("alice"));
        expect(r.timer.state).toBe("idle");
      }
    });
  });

  describe("timeUp", () => {
    const voted = () => run(running(), castVote("bob", "8"));

    it("at the deadline, reveals whether or not everyone has voted, marked as the timer's", () => {
      const revealed = at(NOW + MIN, voted(), { type: "timeUp" });
      expect(revealed.phase).toBe("revealed");
      expect(revealed.revealCause).toBe("timer");
      expect(revealed.timer.state).toBe("idle");
      expect(revealed.version).toBe(voted().version + 1);
    });

    it("before the deadline changes nothing", () => {
      const r = voted();
      expect(at(NOW + MIN - 1, r, { type: "timeUp" })).toBe(r);
    });

    it.each([
      ["idle", () => run(inRoom(), castVote("bob", "8"))],
      ["paused", () => run(paused(), castVote("bob", "8"))],
    ])(
      "changes nothing while %s: only a running timer can reveal",
      (_, timer) => {
        const r = timer();
        expect(at(NOW + 60 * MIN, r, { type: "timeUp" })).toBe(r);
      },
    );

    it("with no votes at all, reveals nothing and goes back to idle", () => {
      const r = at(NOW + MIN, running(), { type: "timeUp" });
      expect(r.phase).toBe("voting");
      expect(r.timer.state).toBe("idle");
    });

    it("is cleared at Start next round, so the next reveal is a person's", () => {
      const next = run(
        at(NOW + MIN, voted(), { type: "timeUp" }),
        reset("alice"),
      );
      expect(next.revealCause).toBeNull();
    });
  });

  it("follows the order of checks for every timer command: unknown, then not connected", () => {
    const r = run(running(), disconnect("bob"));
    for (const type of [
      "timerStart",
      "timerPause",
      "timerResume",
      "timerAdd",
    ]) {
      expect(applyCommand(r, cmd(type, "zed"), NOW)).toEqual({
        ok: false,
        error: "UNKNOWN_PARTICIPANT",
      });
      expect(applyCommand(r, cmd(type, "bob"), NOW)).toEqual({
        ok: false,
        error: "NOT_CONNECTED",
      });
    }
  });
});
