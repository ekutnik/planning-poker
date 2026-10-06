import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { isolate } from "./isolate.js";
import { listNames, roundStatus } from "./status.js";

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;

/** name, "c" connected or "a" away, "v" voted or "-" not */
function room(...people: [string, "c" | "a", "v" | "-"][]): Voting {
  return {
    phase: "voting",
    roomId: "abcdefghijk",
    version: 1,
    viewerId: "Ada",
    ticket: null,
    scores: null,
    timer: {
      durationMs: 60_000,
      state: "idle",
      endsAt: null,
      remainingMs: null,
    },
    yourVote: null,
    participants: people.map(([name, status, vote]) => ({
      id: name,
      name,
      status: status === "c" ? "connected" : "disconnected",
      hasVoted: vote === "v",
    })),
  };
}

describe("roundStatus: who the round waits for", () => {
  it("does not wait for someone away who has not voted", () => {
    const status = roundStatus(
      room(
        ["Ada", "c", "v"],
        ["Ben", "c", "v"],
        ["Cy", "c", "-"],
        ["Dee", "c", "v"],
        ["Eli", "c", "v"],
        ["Fay", "a", "-"],
      ),
    );
    expect(status).toEqual({
      counted: 5,
      voted: 4,
      waitingFor: ["Cy"],
      away: ["Fay"],
      participantLine: "4 of 5 have voted",
      facilitatorLine: `Waiting for ${isolate("Cy")}. ${isolate("Fay")} is away.`,
    });
  });

  it("still counts someone away who has voted", () => {
    const status = roundStatus(room(["Ada", "c", "v"], ["Fay", "a", "v"]));
    expect(status.counted).toBe(2);
    expect(status.away).toEqual([]);
    expect(status.facilitatorLine).toBe("Everyone has voted");
  });

  it("says everyone has voted, and who is away, when the counted have voted", () => {
    const status = roundStatus(
      room(["Ada", "c", "v"], ["Fay", "a", "-"], ["Gus", "a", "-"]),
    );
    expect(status.participantLine).toBe("Everyone has voted");
    expect(status.facilitatorLine).toBe(
      `Everyone has voted. ${isolate("Fay")} and ${isolate("Gus")} are away.`,
    );
  });

  it("names everyone missing, in join order", () => {
    const status = roundStatus(
      room(
        ["Ada", "c", "-"],
        ["Ben", "c", "v"],
        ["Cy", "c", "-"],
        ["Dee", "c", "-"],
      ),
    );
    expect(status.facilitatorLine).toBe(
      `Waiting for ${isolate("Ada")}, ${isolate("Cy")} and ${isolate("Dee")}`,
    );
    expect(status.participantLine).toBe("1 of 4 has voted");
  });

  it("counts a returning participant again once they are connected", () => {
    const away = roundStatus(room(["Ada", "c", "v"], ["Fay", "a", "-"]));
    const back = roundStatus(room(["Ada", "c", "v"], ["Fay", "c", "-"]));
    expect(away.counted).toBe(1);
    expect(back.counted).toBe(2);
    expect(back.facilitatorLine).toBe(`Waiting for ${isolate("Fay")}`);
  });
});

describe("listNames", () => {
  it.each([
    [[], ""],
    [["Cy"], "Cy"],
    [["Cy", "Fay"], "Cy and Fay"],
    [["Ada", "Cy", "Fay"], "Ada, Cy and Fay"],
  ])("%j", (names, text) => {
    expect(listNames(names)).toBe(text);
  });
});
