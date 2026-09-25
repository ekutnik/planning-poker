import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { MAX_NAME_LENGTH } from "../shared/rules.js";
import {
  bannerFor,
  canAct,
  checkName,
  resultLines,
  STOP_ACTIONS,
  voteFor,
} from "./view.js";

const voting: RoomSnapshot = {
  phase: "voting",
  roomId: "abcdefghijk",
  version: 1,
  viewerId: "a",
  yourVote: null,
  participants: [],
};

describe("checkName", () => {
  it("accepts and normalises a valid name", () => {
    expect(checkName("  Ada   L ")).toEqual({ ok: true, name: "Ada L" });
  });

  it("refuses what the domain would refuse, with the copy", () => {
    expect(checkName(" ")).toEqual({
      ok: false,
      message: `Names can be 1 to ${MAX_NAME_LENGTH} characters.`,
    });
    expect(checkName("x".repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
  });
});

describe("connection banner and actions", () => {
  it.each([
    [{ status: "open", snapshot: voting } as const, null, true],
    [
      { status: "connecting", attempt: 0, snapshot: null } as const,
      "Joining the room…",
      false,
    ],
    [
      { status: "connecting", attempt: 2, snapshot: voting } as const,
      "Reconnecting…",
      false,
    ],
    [
      {
        status: "reconnecting",
        attempt: 1,
        retryAt: 0,
        snapshot: voting,
      } as const,
      "Connection lost. Reconnecting…",
      false,
    ],
    [{ status: "stopped", reason: "left" } as const, null, false],
  ])("%o", (state, banner, live) => {
    expect(bannerFor(state)).toBe(banner);
    expect(canAct(state)).toBe(live);
  });
});

describe("voteFor", () => {
  it("casts a different card and clears the one already chosen", () => {
    expect(voteFor(null, "5")).toEqual({ type: "castVote", card: "5" });
    expect(voteFor("3", "5")).toEqual({ type: "castVote", card: "5" });
    expect(voteFor("5", "5")).toEqual({ type: "clearVote" });
  });
});

describe("STOP_ACTIONS", () => {
  it("never reloads automatically and offers a way on from every stop", () => {
    expect(STOP_ACTIONS.outdated).toBe("reload");
    expect(STOP_ACTIONS.superseded).toBe("use-this-tab");
    expect(STOP_ACTIONS["room-full"]).toBe("try-again");
    expect(STOP_ACTIONS["invalid-name"]).toBe("change-name");
  });
});

describe("resultLines", () => {
  const revealed = (
    results: Extract<RoomSnapshot, { phase: "revealed" }>["results"],
  ): Extract<RoomSnapshot, { phase: "revealed" }> => ({
    phase: "revealed",
    roomId: "abcdefghijk",
    version: 3,
    viewerId: "a",
    participants: [
      { id: "a", name: "Ada", status: "connected", vote: "3" },
      { id: "b", name: "Bo", status: "connected", vote: "3" },
      { id: "c", name: "Cy", status: "connected", vote: "21" },
    ],
    results,
  });

  it("lists votes, distribution, range and outliers by name", () => {
    expect(
      resultLines(
        revealed({
          voteCount: 3,
          distribution: [
            { card: "3", count: 2 },
            { card: "21", count: 1 },
          ],
          consensus: false,
          min: "3",
          max: "21",
          spreadSteps: 4,
          wideSpread: true,
          outliers: ["c"],
        }),
      ),
    ).toEqual([
      "3 votes",
      "3: 2",
      "21: 1",
      "Range 3–21, a wide spread.",
      "Outliers: Cy.",
    ]);
  });

  it("says consensus when everyone agrees", () => {
    expect(
      resultLines(
        revealed({
          voteCount: 1,
          distribution: [{ card: "5", count: 1 }],
          consensus: true,
          min: "5",
          max: "5",
          spreadSteps: 0,
          wideSpread: false,
          outliers: [],
        }),
      ),
    ).toEqual(["1 vote", "5: 1", "Consensus."]);
  });
});
