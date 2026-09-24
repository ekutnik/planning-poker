import { describe, expect, it } from "vitest";
import { applyCommand, createRoom, type Command, type Room } from "./room.js";
import { computeResults } from "./results.js";
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
const leave = (participantId: string): Command => ({
  type: "leave",
  participantId,
});

/** Build a room where p0, p1, … each cast the given vote, in that join order. */
function roomWithVotes(votes: readonly Card[]): Room {
  const commands = votes.flatMap((card, i) => [
    join(`p${i}`),
    castVote(`p${i}`, card),
  ]);
  return run(createRoom("r"), ...commands);
}

describe("computeResults", () => {
  const rows = [
    {
      name: "unanimous numbers → consensus",
      votes: ["5", "5", "5"],
      consensus: true,
      min: "5",
      max: "5",
      spreadSteps: 0,
      wideSpread: false,
      outliers: [],
    },
    {
      name: "a single voter is never consensus",
      votes: ["5"],
      consensus: false,
      min: "5",
      max: "5",
      spreadSteps: 0,
      wideSpread: false,
      outliers: [],
    },
    {
      name: "a ? breaks consensus",
      votes: ["5", "5", "?"],
      consensus: false,
      min: "5",
      max: "5",
      spreadSteps: 0,
      wideSpread: false,
      outliers: [],
    },
    {
      name: "adjacent cards are a narrow spread",
      votes: ["3", "5"],
      consensus: false,
      min: "3",
      max: "5",
      spreadSteps: 1,
      wideSpread: false,
      outliers: [],
    },
    {
      name: "two steps apart is a wide spread with outliers",
      votes: ["3", "5", "8"],
      consensus: false,
      min: "3",
      max: "8",
      spreadSteps: 2,
      wideSpread: true,
      outliers: ["p0", "p2"],
    },
    {
      name: "13 and 21 are adjacent in deck steps, not arithmetic",
      votes: ["13", "21"],
      consensus: false,
      min: "13",
      max: "21",
      spreadSteps: 1,
      wideSpread: false,
      outliers: [],
    },
    {
      name: "everyone is an outlier when the whole room splits min/max",
      votes: ["1", "1", "13", "13"],
      consensus: false,
      min: "1",
      max: "13",
      spreadSteps: 5,
      wideSpread: true,
      outliers: ["p0", "p1", "p2", "p3"],
    },
    {
      name: "non-numeric votes only → no min/max/spread",
      votes: ["?", "☕"],
      consensus: false,
      min: null,
      max: null,
      spreadSteps: null,
      wideSpread: false,
      outliers: [],
    },
  ] as const;

  it.each(rows)(
    "$name",
    ({ votes, consensus, min, max, spreadSteps, wideSpread, outliers }) => {
      const results = computeResults(roomWithVotes(votes));
      expect(results.voteCount).toBe(votes.length);
      expect(results.consensus).toBe(consensus);
      expect(results.min).toBe(min);
      expect(results.max).toBe(max);
      expect(results.spreadSteps).toBe(spreadSteps);
      expect(results.wideSpread).toBe(wideSpread);
      expect(results.outliers).toEqual(outliers);
    },
  );

  it("counts a disconnected participant's vote", () => {
    const room = run(
      createRoom("r"),
      join("alice"),
      join("bob"),
      castVote("alice", "5"),
      castVote("bob", "5"),
      disconnect("bob"),
    );
    const results = computeResults(room);
    expect(results.voteCount).toBe(2);
    expect(results.consensus).toBe(true);
    expect(results.min).toBe("5");
    expect(results.max).toBe("5");
  });

  it("returns empty results when every voter has left after reveal", () => {
    const room = run(
      createRoom("r"),
      join("alice"),
      castVote("alice", "5"),
      reveal("alice"),
      leave("alice"),
    );
    expect(computeResults(room)).toEqual({
      voteCount: 0,
      distribution: [],
      consensus: false,
      min: null,
      max: null,
      spreadSteps: null,
      wideSpread: false,
      outliers: [],
    });
  });

  it("reports the distribution in deck order, only for cards cast", () => {
    const results = computeResults(roomWithVotes(["5", "5", "3", "?"]));
    expect(results.distribution).toEqual([
      { card: "3", count: 1 },
      { card: "5", count: 2 },
      { card: "?", count: 1 },
    ]);
  });
});
