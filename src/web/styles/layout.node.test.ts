import { describe, expect, it } from "vitest";
import { declarations, readStyles } from "./css.node.js";

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
