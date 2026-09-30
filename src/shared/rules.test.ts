import { describe, expect, it } from "vitest";
import {
  cleanTicket,
  MAX_NAME_LENGTH,
  MAX_TICKET_LENGTH,
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

describe("tickets (cleanTicket)", () => {
  it.each([
    [
      "plain text",
      "PROJ-482 Admins can sign in with SSO",
      "PROJ-482 Admins can sign in with SSO",
    ],
    ["trims the ends", "  PROJ-1  ", "PROJ-1"],
    [
      "collapses runs of spaces and tabs",
      "PROJ-1 \t  Fix   it",
      "PROJ-1 Fix it",
    ],
    [
      "a pasted line break separates words",
      "PROJ-1\nFix it\r\nnow",
      "PROJ-1 Fix it now",
    ],
    [
      "removes control characters",
      "PROJ\u0000-1\u0007 Fix\u007f it",
      "PROJ-1 Fix it",
    ],
    ["keeps an emoji and accents", "Café 🚀 résumé", "Café 🚀 résumé"],
    ["keeps markup as text", "<b>x</b>", "<b>x</b>"],
    ["empty is no ticket", "", null],
    ["only whitespace is no ticket", " \t\n ", null],
    ["only control characters is no ticket", "\u0000\u0007", null],
  ])("%s", (_, raw, cleaned) => {
    expect(cleanTicket(raw)).toBe(cleaned);
  });

  it("leaves the length rule to the caller, measured after cleaning", () => {
    expect(MAX_TICKET_LENGTH).toBe(120);
    expect(cleanTicket(`   ${"x".repeat(120)}   `)).toHaveLength(120);
    expect(cleanTicket("x".repeat(121))).toHaveLength(121);
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
