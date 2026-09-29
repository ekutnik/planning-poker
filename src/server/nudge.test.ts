import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createRoom,
  type Command,
  type Room,
} from "./domain/room.js";
import { NUDGE_COOLDOWN_MS } from "../shared/rules.js";
import { nudgeRefusal } from "./nudge.js";

const NOW = 100_000;

function run(...commands: Command[]): Room {
  return commands.reduce((room, command) => {
    const result = applyCommand(room, command, NOW);
    if (!result.ok) throw new Error(`Expected ok, got ${result.error}`);
    return result.room;
  }, createRoom("r"));
}

const join = (id: string): Command => ({
  type: "join",
  participantId: id,
  name: id,
});

// Ada nudges Ben, who is here and has not voted; Cy has voted.
const voting = run(join("ada"), join("ben"), join("cy"), {
  type: "castVote",
  participantId: "cy",
  card: "5",
});

describe("nudgeRefusal: who may be nudged", () => {
  it("lets a nudge through to someone here who has not voted", () => {
    expect(nudgeRefusal(voting, "ada", "ben", undefined, NOW)).toBeNull();
  });

  it.each([
    [
      "the round is revealed",
      run(
        join("ada"),
        join("ben"),
        { type: "castVote", participantId: "ada", card: "5" },
        { type: "reveal", participantId: "ada" },
      ),
      "ada",
      "ben",
      "NOT_VOTING",
    ],
    ["the sender is not in the room", voting, "eli", "ben", "NOT_IN_ROOM"],
    ["it is yourself", voting, "ada", "ada", "SELF"],
    [
      "nobody by that id is in the room",
      voting,
      "ada",
      "fay",
      "NO_SUCH_PERSON",
    ],
    [
      "they are away",
      run(join("ada"), join("ben"), {
        type: "disconnect",
        participantId: "ben",
      }),
      "ada",
      "ben",
      "AWAY",
    ],
    ["they have voted", voting, "ada", "cy", "HAS_VOTED"],
  ] as const)("refuses when %s", (_, room, from, to, refusal) => {
    expect(nudgeRefusal(room, from, to, undefined, NOW)).toBe(refusal);
  });
});

describe("nudgeRefusal: the cooldown", () => {
  it("refuses a second nudge within 30 seconds of the last", () => {
    expect(
      nudgeRefusal(voting, "ada", "ben", NOW - NUDGE_COOLDOWN_MS + 1, NOW),
    ).toBe("COOLDOWN");
  });

  it("lets one through once 30 seconds have passed", () => {
    expect(NUDGE_COOLDOWN_MS).toBe(30_000);
    expect(
      nudgeRefusal(voting, "ada", "ben", NOW - NUDGE_COOLDOWN_MS, NOW),
    ).toBeNull();
  });

  it("checks the person first: a voted target is refused as voted, not cooling down", () => {
    expect(nudgeRefusal(voting, "ada", "cy", NOW - 1, NOW)).toBe("HAS_VOTED");
  });
});
