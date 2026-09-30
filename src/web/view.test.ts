import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { MAX_NAME_LENGTH } from "../shared/rules.js";
import { bannerFor, canAct, checkName, STOP_ACTIONS, voteFor } from "./view.js";

const voting: RoomSnapshot = {
  phase: "voting",
  roomId: "abcdefghijk",
  version: 1,
  viewerId: "a",
  ticket: null,
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
    [
      {
        status: "reconnecting",
        attempt: 1,
        retryAt: 0,
        snapshot: voting,
        restarting: true,
      } as const,
      "The server is restarting. Reconnecting…",
      false,
    ],
    [
      {
        status: "connecting",
        attempt: 1,
        snapshot: voting,
        restarting: true,
      } as const,
      "The server is restarting. Reconnecting…",
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
