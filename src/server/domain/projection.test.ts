import { describe, expect, it } from "vitest";
import { applyCommand, createRoom, type Command, type Room } from "./room.js";
import { project } from "./projection.js";
import type { Card } from "../../shared/deck.js";

const NOW = 1_000;

function run(room: Room, ...commands: Command[]): Room {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command, NOW);
    if (!result.ok) throw new Error(`Expected ok, got ${result.error}`);
    return result.room;
  }, room);
}

const join = (participantId: string): Command => ({
  type: "join",
  participantId,
  name: participantId,
});
const castVote = (participantId: string, card: Card): Command => ({
  type: "castVote",
  participantId,
  card,
});
const reveal = (participantId: string): Command => ({
  type: "reveal",
  participantId,
});
const disconnect = (participantId: string): Command => ({
  type: "disconnect",
  participantId,
});

/** Alice voted 5, Bob voted 8, Carol hasn't voted, Dan voted 13 then dropped. */
function mixedRoom(): Room {
  return run(
    createRoom("r1"),
    join("alice"),
    join("bob"),
    join("carol"),
    join("dan"),
    castVote("alice", "5"),
    castVote("bob", "8"),
    castVote("dan", "13"),
    disconnect("dan"),
  );
}

/** Round-trip through JSON so we test exactly what goes on the wire. */
function onWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

const OWN_VOTE: Record<string, Card | null> = {
  alice: "5",
  bob: "8",
  carol: null,
  dan: "13",
};

describe("project — no-leak (key whitelist)", () => {
  const viewers = ["alice", "bob", "carol", "dan"] as const;

  it.each(viewers)("before reveal, %s sees only their own vote", (viewer) => {
    const snapshot = onWire(project(mixedRoom(), viewer)) as {
      phase: string;
      yourVote: Card | null;
      participants: Record<string, unknown>[];
    };

    expect(snapshot.phase).toBe("voting");
    // Envelope whitelist: a leak can also sit at the top level (e.g. a future
    // "convenience" results field during voting). The secret cannot be present.
    expect(Object.keys(snapshot).sort()).toEqual([
      "participants",
      "phase",
      "roomId",
      "scores",
      "ticket",
      "version",
      "viewerId",
      "yourVote",
    ]);
    // The viewer's own vote, and nothing about anyone else's value.
    expect(snapshot.yourVote).toBe(OWN_VOTE[viewer]);

    for (const view of snapshot.participants) {
      // Exact key whitelist: no "vote" can hide here, whatever its value.
      expect(Object.keys(view).sort()).toEqual([
        "hasVoted",
        "id",
        "name",
        "status",
      ]);
    }
  });

  it("after reveal, every vote and the results are present", () => {
    const revealed = run(mixedRoom(), reveal("alice"));
    const snapshot = onWire(project(revealed, "carol")) as {
      phase: string;
      participants: { id: string; vote: Card | null }[];
      results: { voteCount: number };
    };

    expect(snapshot.phase).toBe("revealed");
    expect(Object.keys(snapshot).sort()).toEqual([
      "participants",
      "phase",
      "results",
      "roomId",
      "scores",
      "ticket",
      "version",
      "viewerId",
    ]);
    for (const view of snapshot.participants) {
      expect(Object.keys(view).sort()).toEqual([
        "id",
        "name",
        "status",
        "vote",
      ]);
    }
    expect(snapshot.results.voteCount).toBe(3);
    const votes = Object.fromEntries(
      snapshot.participants.map((p) => [p.id, p.vote]),
    );
    expect(votes).toEqual({ alice: "5", bob: "8", carol: null, dan: "13" });
  });
});

describe("project — determinism and suppression", () => {
  it("is deterministic: same room and viewer give a deep-equal snapshot", () => {
    const room = mixedRoom();
    expect(project(room, "carol")).toEqual(project(room, "carol"));
  });

  it("hides a pre-reveal vote change from others (identical except version)", () => {
    const before = mixedRoom();
    // Bob changes his vote 8 -> 13. Carol is watching.
    const after = run(before, castVote("bob", "13"));

    const stripVersion = (room: Room) => {
      const snapshot: Record<string, unknown> = { ...project(room, "carol") };
      delete snapshot.version;
      return snapshot;
    };

    // The version must actually have moved...
    expect(project(after, "carol").version).toBeGreaterThan(
      project(before, "carol").version,
    );
    // ...but nothing else in Carol's projection changed.
    expect(stripVersion(after)).toEqual(stripVersion(before));
  });
});

describe("the ticket", () => {
  const viewers = ["alice", "bob", "carol", "dan"] as const;

  it("is the same for every viewer, before and after reveal", () => {
    const withTicket = { ...mixedRoom(), ticket: "PROJ-482 Fix it" };
    for (const room of [
      withTicket,
      { ...withTicket, phase: "revealed" as const },
    ]) {
      for (const viewer of viewers) {
        expect(project(room, viewer).ticket).toBe("PROJ-482 Fix it");
      }
    }
  });

  it("is null when the room has none", () => {
    expect(project(mixedRoom(), "alice").ticket).toBeNull();
  });
});

describe("scores", () => {
  const viewers = ["alice", "bob", "carol", "dan"] as const;
  const withScores = (scoring: boolean): Room => ({
    ...mixedRoom(),
    scoring,
    scores: new Map([["bob", 2]]),
  });

  it("appear nowhere while scoring is off, though the room keeps them", () => {
    const room = withScores(false);
    for (const r of [room, { ...room, phase: "revealed" as const }]) {
      for (const viewer of viewers) {
        const wire = JSON.stringify(project(r, viewer));
        expect(project(r, viewer).scores).toBeNull();
        expect(wire).not.toContain('"scores":{');
      }
    }
  });

  it("while on, are everyone's points, the same for every viewer, in join order, 0 for none", () => {
    const room = withScores(true);
    for (const r of [room, { ...room, phase: "revealed" as const }]) {
      for (const viewer of viewers) {
        const scores = project(r, viewer).scores;
        expect(scores).toEqual({ alice: 0, bob: 2, carol: 0, dan: 0 });
        expect(Object.keys(scores ?? {})).toEqual([
          "alice",
          "bob",
          "carol",
          "dan",
        ]);
      }
    }
  });
});
