import { describe, expect, it } from "vitest";
import { WIDE_MIN_WIDTH, WIDE_QUERY } from "../breakpoint.js";
import { declarations, readStyles, split } from "./css.node.js";

const css = readStyles();

describe("names on the scale (A-04)", () => {
  const scaleName = declarations(css, ".scale-name");

  it("keep each name on one line, cut short visually when too long", () => {
    expect(scaleName).toMatch(/white-space:\s*nowrap/);
    expect(scaleName).toMatch(/overflow:\s*hidden/);
    expect(scaleName).toMatch(/text-overflow:\s*ellipsis/);
    expect(scaleName).toMatch(/max-inline-size:\s*100%/);
  });

  it("never break a name mid-word, where it would read as two people", () => {
    expect(scaleName).not.toMatch(/overflow-wrap|word-break/);
  });
});

describe("the pinned facilitator bar (A-05)", () => {
  const tall = split(css, "(height >= 25em) and (width < 55em)");

  it("is pinned only in compact, when the window is tall enough", () => {
    expect(tall.inside).toMatch(/position:\s*sticky/);
    expect(tall.outside).not.toMatch(/position:\s*sticky/);
  });

  it("reserves scroll room for itself only while pinned", () => {
    const reserved = /scroll-padding-block-end:\s*calc/;
    expect(tall.inside).toMatch(reserved);
    expect(tall.outside).not.toMatch(reserved);
  });
});

describe("the Menu's panel (#48)", () => {
  it("never sets display on the panel itself, so hidden really hides it", () => {
    // A display rule on .menu-panel would override the hidden attribute.
    expect(declarations(css, ".menu-panel")).not.toMatch(/display\s*:/);
    expect(declarations(css, ".menu-panel:not([hidden])")).toMatch(
      /display:\s*flex/,
    );
  });

  it("is positioned against the Menu itself", () => {
    expect(declarations(css, ".menu")).toMatch(/position:\s*relative/);
  });
});

describe("one breakpoint (docs/design.md, Layout)", () => {
  const preludes = [...css.matchAll(/@media\s*([^{]+)\{/g)].map(
    ([, prelude = ""]) => prelude.trim(),
  );
  const widthPreludes = preludes.filter((prelude) => /width/.test(prelude));

  it("is found in the stylesheets, so the checks below are not vacuous", () => {
    expect(widthPreludes.length).toBeGreaterThan(2);
  });

  it("uses the script's breakpoint in every width query", () => {
    for (const prelude of widthPreludes) {
      const lengths = [
        ...prelude.matchAll(/width\s*(?::|<=?|>=?)\s*([\d.]+[a-z]+)/g),
      ].map(([, length]) => length);
      expect(lengths.length).toBeGreaterThan(0);
      for (const length of lengths) expect(length).toBe(WIDE_MIN_WIDTH);
    }
  });

  it("writes every min-width query exactly as useWide does", () => {
    for (const prelude of widthPreludes.filter((p) =>
      p.includes("min-width"),
    )) {
      expect(prelude).toBe(WIDE_QUERY);
    }
  });
});
