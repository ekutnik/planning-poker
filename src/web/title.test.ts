import { describe, expect, it } from "vitest";
import { DECK } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { STOP_COPY } from "./copy.js";
import { documentTitle, roomTitle, titleOf } from "./title.js";

const ROOM_ID = "abcdefghijk";

function voting(
  ...people: [string, "connected" | "disconnected", boolean][]
): RoomSnapshot {
  return {
    phase: "voting",
    roomId: ROOM_ID,
    version: 3,
    viewerId: "Ada",
    ticket: null,
    scores: null,
    timer: {
      durationMs: 60_000,
      state: "idle",
      endsAt: null,
      remainingMs: null,
    },
    yourVote: "13",
    participants: people.map(([name, status, hasVoted]) => ({
      id: name,
      name,
      status,
      hasVoted,
    })),
  };
}

describe("document titles (A-03)", () => {
  it("names the screen, then the app", () => {
    expect(documentTitle(null)).toBe("Planning Poker Session");
    expect(documentTitle("Join the room")).toBe(
      "Join the room – Planning Poker Session",
    );
    expect(documentTitle(titleOf(STOP_COPY.left.title))).toBe(
      "You left the room – Planning Poker Session",
    );
  });

  it("carries the round in the room: who is still waiting, then revealed", () => {
    const two = voting(
      ["Ada", "connected", true],
      ["Ben", "connected", false],
      ["Cy", "connected", false],
      ["Fay", "disconnected", false], // away: not waited for
    );
    expect(roomTitle(two)).toBe("2 waiting");
    expect(roomTitle(voting(["Ada", "connected", true]))).toBe(
      "Everyone voted",
    );
    expect(
      roomTitle({
        phase: "revealed",
        roomId: ROOM_ID,
        version: 4,
        viewerId: "Ada",
        ticket: null,
        scores: null,
        timer: {
          durationMs: 60_000,
          state: "idle",
          endsAt: null,
          remainingMs: null,
        },
        revealCause: null,
        participants: [
          { id: "Ada", name: "Ada", status: "connected", vote: "13" },
        ],
        results: {
          voteCount: 1,
          distribution: [{ card: "13", count: 1 }],
          consensus: false,
          min: "13",
          max: "13",
          spreadSteps: 0,
          winners: [],
        },
      }),
    ).toBe("Votes revealed");
  });

  it("never shows a vote or the room id", () => {
    const title = documentTitle(
      roomTitle(
        voting(["Ada", "connected", true], ["Ben", "connected", false]),
      ),
    );
    expect(title).not.toContain(ROOM_ID);
    for (const card of DECK.filter((card) => card !== "1")) {
      expect(title).not.toContain(card); // "1 waiting" is a count, not a card
    }
  });
});
