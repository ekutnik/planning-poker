import { describe, expect, it } from "vitest";
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
  const tall = split(css, "(min-height: 25em)");

  it("is pinned only when the window is tall enough", () => {
    expect(tall.inside).toMatch(/position:\s*sticky/);
    expect(tall.outside).not.toMatch(/position:\s*sticky/);
  });

  it("reserves scroll room for itself only while pinned", () => {
    const reserved = /scroll-padding-block-end:\s*calc/;
    expect(tall.inside).toMatch(reserved);
    expect(tall.outside).not.toMatch(reserved);
  });
});
