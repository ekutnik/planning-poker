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
