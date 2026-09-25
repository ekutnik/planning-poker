import { describe, expect, it } from "vitest";
import { derivePublicId, generateRoomId, roomLogId } from "./identity.js";
import { ROOM_ID_PATTERN } from "../shared/rules.js";

describe("derivePublicId", () => {
  it("is deterministic", () => {
    expect(derivePublicId("room-one", "token-one")).toBe(
      derivePublicId("room-one", "token-one"),
    );
  });

  it("gives the same token a different id in a different room", () => {
    expect(derivePublicId("room-one", "token-one")).not.toBe(
      derivePublicId("room-two", "token-one"),
    );
  });

  it("is exactly 16 base64url characters", () => {
    expect(derivePublicId("room-one", "token-one")).toMatch(
      /^[A-Za-z0-9_-]{16}$/,
    );
  });
});

describe("generateRoomId", () => {
  it("always matches ROOM_ID_PATTERN", () => {
    for (let i = 0; i < 1_000; i++) {
      expect(generateRoomId()).toMatch(ROOM_ID_PATTERN);
    }
  });
});

describe("roomLogId", () => {
  it("is 8 hex characters and deterministic", () => {
    expect(roomLogId("abcdefghijk")).toMatch(/^[0-9a-f]{8}$/);
    expect(roomLogId("abcdefghijk")).toBe(roomLogId("abcdefghijk"));
  });

  it("differs between rooms", () => {
    expect(roomLogId("abcdefghijk")).not.toBe(roomLogId("bbbbbbbbbbb"));
  });
});
