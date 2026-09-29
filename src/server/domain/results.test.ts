import { describe, expect, it } from "vitest";
import { applyCommand, createRoom, type Command, type Room } from "./room.js";
import { computeResults, winningCards } from "./results.js";
import type { Card, NumericCard } from "../../shared/deck.js";

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
    },
    {
      name: "a single voter is never consensus",
      votes: ["5"],
      consensus: false,
      min: "5",
      max: "5",
      spreadSteps: 0,
    },
    {
      name: "a ? breaks consensus",
      votes: ["5", "5", "?"],
      consensus: false,
      min: "5",
      max: "5",
      spreadSteps: 0,
    },
    {
      name: "adjacent cards are a narrow spread",
      votes: ["3", "5"],
      consensus: false,
      min: "3",
      max: "5",
      spreadSteps: 1,
    },
    {
      name: "spread is counted in deck steps",
      votes: ["3", "5", "8"],
      consensus: false,
      min: "3",
      max: "8",
      spreadSteps: 2,
    },
    {
      name: "13 and 21 are adjacent in deck steps, not arithmetic",
      votes: ["13", "21"],
      consensus: false,
      min: "13",
      max: "21",
      spreadSteps: 1,
    },
    {
      name: "a room split between two cards spans every step between them",
      votes: ["1", "1", "13", "13"],
      consensus: false,
      min: "1",
      max: "13",
      spreadSteps: 5,
    },
    {
      name: "non-numeric votes only → no min/max/spread",
      votes: ["?", "☕"],
      consensus: false,
      min: null,
      max: null,
      spreadSteps: null,
    },
  ] as const;

  it.each(rows)("$name", ({ votes, consensus, min, max, spreadSteps }) => {
    const results = computeResults(roomWithVotes(votes));
    expect(results.voteCount).toBe(votes.length);
    expect(results.consensus).toBe(consensus);
    expect(results.min).toBe(min);
    expect(results.max).toBe(max);
    expect(results.spreadSteps).toBe(spreadSteps);
  });

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
      winners: [],
    });
  });

  it("reports the winners in the room's results", () => {
    expect(
      computeResults(roomWithVotes(["5", "8", "8", "8", "?"])).winners,
    ).toEqual(["8"]);
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

describe("winningCards: the team's rule (docs/design.md)", () => {
  // The worked examples, as written in the design.
  const examples: readonly [
    string,
    readonly NumericCard[],
    readonly NumericCard[],
  ][] = [
    ["8 wins", ["5", "8", "8", "8", "13"], ["8"]],
    ["3 wins", ["3", "3", "3", "5", "8"], ["3"]],
    ["a draw between 3 and 5", ["2", "3", "3", "5", "5", "13"], ["3", "5"]],
    ["8 wins from a three-way tie", ["2", "2", "8", "8", "13", "13"], ["8"]],
    ["no winner: 3 had two votes before dropping", ["3", "3", "8", "13"], []],
    ["no winner: one vote left", ["3", "5", "8"], []],
    ["no winner: one each", ["2", "3", "5", "8", "13"], []],
    ["no winner: nothing left", ["5", "8"], []],
    ["everyone agrees", ["5", "5", "5", "5", "5"], ["5"]],
    ["two agreeing votes win, with nothing to drop", ["5", "5"], ["5"]],
    ["a single vote never wins", ["8"], []],
    ["no votes, no winner", [], []],
  ];

  it.each(examples)("%s", (_, votes, winners) => {
    expect(winningCards(votes)).toEqual(winners);
  });

  it("finds the same winners in any order the votes arrive", () => {
    expect(winningCards(["13", "5", "3", "5", "3", "2"])).toEqual(["3", "5"]);
  });

  it("ignores ? and ☕: 5, 5, 5, ? is a win for 5", () => {
    const results = computeResults(roomWithVotes(["5", "5", "5", "?"]));
    expect(results.winners).toEqual(["5"]);
    expect(results.consensus).toBe(false);
  });

  it.each([[["?", "?"]], [["5", "?", "?", "?"]], [["☕", "☕"]]] as const)(
    "lets nothing but numbers win: %j",
    (votes) => {
      // Each would win if ? or ☕ counted: agreeing, or the most after dropping.
      expect(computeResults(roomWithVotes(votes)).winners).toEqual([]);
    },
  );
});
