import { describe, expect, it } from "vitest";
import {
  MAX_NAME_LENGTH,
  normaliseName,
  ROOM_ID_PATTERN,
  SESSION_TOKEN_PATTERN,
  validName,
} from "./rules.js";

describe("names", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseName("  Ada \t\n Lovelace  ")).toBe("Ada Lovelace");
  });

  it("accepts 1 to MAX_NAME_LENGTH characters after normalising", () => {
    expect(validName("A")).toBe("A");
    expect(validName(`  ${"x".repeat(MAX_NAME_LENGTH)}  `)).toBe(
      "x".repeat(MAX_NAME_LENGTH),
    );
    expect(validName("x".repeat(MAX_NAME_LENGTH + 1))).toBeNull();
    expect(validName(" \t ")).toBeNull();
  });
});

describe("patterns", () => {
  it("room ids are exactly 11 base64url characters", () => {
    expect(ROOM_ID_PATTERN.test("abcdefghij_")).toBe(true);
    expect(ROOM_ID_PATTERN.test("abcdefghij")).toBe(false);
    expect(ROOM_ID_PATTERN.test("abcdefghij!")).toBe(false);
  });

  it("session tokens fit a randomUUID and reject anything else", () => {
    expect(SESSION_TOKEN_PATTERN.test(crypto.randomUUID())).toBe(true);
    expect(SESSION_TOKEN_PATTERN.test("short")).toBe(false);
    expect(SESSION_TOKEN_PATTERN.test("x".repeat(21) + "!")).toBe(false);
  });
});
