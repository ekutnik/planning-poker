import { describe, expect, it } from "vitest";
import {
  cleanText,
  cleanTicket,
  MAX_NAME_LENGTH,
  MAX_TICKET_LENGTH,
  normaliseName,
  ROOM_ID_PATTERN,
  SESSION_TOKEN_PATTERN,
  stripInvisible,
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

describe("invisible and direction-changing characters (#80)", () => {
  // Every code point is written as an escape: a literal invisible character
  // in the source is one nobody reviewing it can see.
  const REMOVED = [
    // Direction controls.
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
    0x2067, 0x2068, 0x2069,
    // Zero-width and invisible.
    0x00ad, 0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x200b, 0x2060,
    0x2061, 0x2062, 0x2063, 0x2064, 0x3164, 0xfeff, 0xffa0,
  ];
  const hex = (c: number) =>
    `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
  const SCOTLAND =
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";

  it.each(REMOVED.map((c) => [hex(c), c]))(
    "removes %s between two letters",
    (_, c) => {
      expect(stripInvisible(`A${String.fromCodePoint(c)}B`)).toBe("AB");
    },
  );

  it.each([
    ["a family (ZWJ)", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"],
    ["a technologist (ZWJ)", "\u{1F469}\u200D\u{1F4BB}"],
    ["one with a skin tone (ZWJ)", "\u{1F469}\u{1F3FD}\u200D\u{1F4BB}"],
    ["a red heart (VS16)", "\u2764\uFE0F"],
    ["a heart on fire (VS16, then ZWJ)", "\u2764\uFE0F\u200D\u{1F525}"],
    ["a keycap (VS16, then the keycap)", "1\uFE0F\u20E3"],
    ["the Scotland flag (tags)", SCOTLAND],
    [
      "the England flag (tags)",
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    ],
    [
      "a Persian word (ZWNJ)",
      "\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645",
    ],
    ["a Hindi conjunct (ZWJ)", "\u0915\u094D\u200D\u0937"],
    ["an Arabic name", "\u0639\u0644\u064A"],
    ["a Hebrew name", "\u05D3\u05E0\u05D4"],
    ["accents", "Ren\u00E9e Z\u00F6e"],
  ])("keeps %s", (_, text) => {
    expect(cleanText(text)).toBe(text);
    expect(cleanTicket(text)).toBe(text);
    expect(validName(text)).toBe(text);
  });

  it.each([
    ["a right-to-left override", "\u202Eevil", "evil"],
    ["a zero-width space between letters", "Ad\u200Ba", "Ada"],
    ["a leading ZWJ", "\u200DAda", "Ada"],
    ["a trailing ZWNJ", "Ada\u200C", "Ada"],
    ["a repeated ZWJ, down to one", "a\u200D\u200Db", "a\u200Db"],
    ["a ZWJ beside a space", "Ada \u200DLovelace", "Ada Lovelace"],
    ["a leading variation selector", "\uFE0FAda", "Ada"],
    [
      "a repeated variation selector, down to one",
      "\u2764\uFE0F\uFE0F",
      "\u2764\uFE0F",
    ],
    ["a tag outside a flag", "Ada\u{E0041}\u{E007F}", "Ada"],
    [
      "the tags of a flag with no cancel tag",
      "\u{1F3F4}\u{E0067}\u{E0062}",
      "\u{1F3F4}",
    ],
    ["an isolate typed in", "\u2068Ada", "Ada"],
    [
      "one between two spaces, leaving no double space",
      "Ada \u200B Lovelace",
      "Ada Lovelace",
    ],
    ["a control character, in a name too", "Ada\u0000", "Ada"],
    ["a decomposed accent, to NFC", "Rene\u0301e", "Ren\u00E9e"],
    [
      "an accent cut off by a removed character, to NFC",
      "Rene\u200B\u0301e",
      "Ren\u00E9e",
    ],
  ])("removes %s", (_, raw, cleaned) => {
    expect(cleanText(raw)).toBe(cleaned);
  });

  it.each([
    ["U+3164 alone", "\u3164"],
    ["a zero-width space alone", "\u200B"],
    ["a ZWJ and a variation selector", "\u200D\uFE0F"],
    ["direction marks around spaces", "\u200F \u200E"],
  ])("counts %s as empty: an invalid name, and no ticket", (_, raw) => {
    expect(validName(raw)).toBeNull();
    expect(cleanTicket(raw)).toBeNull();
  });

  describe("on arbitrary text", () => {
    // Seeded, so a failure repeats: text drawn mostly from the characters
    // the rule is about, with letters, marks, spaces and anything at all.
    const POOL = [
      ...REMOVED,
      0x200c,
      0x200d,
      0xfe0f,
      0xfe0e,
      0x1f3f4,
      0xe0067,
      0xe0062,
      0xe007f,
      0xe0041,
      0x0000,
      0x0007,
      0x0020,
      0x0009,
      0x000a,
      0x0301,
      0x094d,
      0x0041,
      0x0065,
      0x0639,
      0x2764,
      0x1f469,
      0x1f3fd,
    ];
    function texts(count: number): string[] {
      let seed = 0x80;
      const random = () => {
        // mulberry32
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      return Array.from({ length: count }, () => {
        const length = Math.floor(random() * 12);
        let text = "";
        for (let i = 0; i < length; i += 1) {
          const c =
            random() < 0.8
              ? (POOL[Math.floor(random() * POOL.length)] ?? 0)
              : Math.floor(random() * 0x110000);
          // A lone surrogate is not a code point a string can carry whole.
          text += c >= 0xd800 && c <= 0xdfff ? "x" : String.fromCodePoint(c);
        }
        return text;
      });
    }

    it("is idempotent: cleaning twice changes nothing", () => {
      for (const text of texts(20_000)) {
        const once = cleanText(text);
        expect(cleanText(once)).toBe(once);
      }
    });

    it("leaves no code point from the list, and no tag outside a flag", () => {
      for (const text of texts(20_000)) {
        const cleaned = cleanText(text);
        for (const char of cleaned) {
          expect(REMOVED).not.toContain(char.codePointAt(0));
        }
        const flagless = cleaned.replace(
          /\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]+\u{E007F}/gu,
          "",
        );
        expect(flagless).not.toMatch(/[\u{E0000}-\u{E007F}]/u);
      }
    });
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
    [
      "leaves no double space where one went",
      "PROJ-1 \u0000 Fix",
      "PROJ-1 Fix",
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
