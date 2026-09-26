import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Read from disk: Vitest turns every CSS import into an empty string.
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** Every colour token, as [light, dark], parsed from light-dark(). */
function colours(): Record<string, [string, string]> {
  const found: Record<string, [string, string]> = {};
  const pattern =
    /--([a-z-]+):\s*light-dark\(\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\s*\)/gi;
  for (const [, name, light, dark] of tokens.matchAll(pattern)) {
    if (name && light && dark) found[name] = [light, dark];
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** A token's [light, dark] values; fails loudly on a typo. */
function pair(palette: Record<string, [string, string]>, name: string) {
  const found = palette[name];
  if (found === undefined) throw new Error(`no colour token --${name}`);
  return found;
}

/** The contrast of two tokens, [light, dark]. */
function against(
  palette: Record<string, [string, string]>,
  fore: string,
  back: string,
): [number, number] {
  const [foreLight, foreDark] = pair(palette, fore);
  const [backLight, backDark] = pair(palette, back);
  return [contrast(foreLight, backLight), contrast(foreDark, backDark)];
}

describe("colour tokens", () => {
  const palette = colours();
  const ratios = (fore: string, back: string) => against(palette, fore, back);

  it("defines every colour for both themes", () => {
    expect(Object.keys(palette).sort()).toEqual(
      [
        "paper",
        "surface",
        "ink",
        "quiet",
        "rule",
        "edge",
        "cobalt",
        "on-cobalt",
        "voted-bg",
        "voted-text",
        "not-yet-bg",
        "not-yet-text",
        "away-bg",
        "away-text",
        "draw-bg",
        "draw-text",
        "name-bg",
        "name-text",
        "facilitating-bg",
        "facilitating-text",
        "win-fill",
        "win-border",
        "win-numeral",
        "draw-fill",
        "draw-border",
        "draw-numeral",
      ].sort(),
    );
  });

  // Tier 1, meaning: everything that carries meaning must read over a
  // compressed screen share, so WCAG AA for normal text, in both themes, on
  // the page and on a card or the menu panel.
  it.each([
    ["ink", "paper"],
    ["ink", "surface"],
    ["quiet", "paper"],
    ["quiet", "surface"],
    ["cobalt", "paper"],
    ["cobalt", "surface"],
    ["on-cobalt", "cobalt"],
    ["voted-text", "voted-bg"],
    ["not-yet-text", "not-yet-bg"],
    ["away-text", "away-bg"],
    ["draw-text", "draw-bg"],
    ["name-text", "name-bg"],
    ["facilitating-text", "facilitating-bg"],
    ["win-numeral", "win-fill"],
    ["draw-numeral", "draw-fill"],
  ])("%s on %s is at least 4.5:1 in both themes", (fore, back) => {
    for (const ratio of ratios(fore, back)) {
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  // Tier 2, boundaries: WCAG 1.4.11 needs 3:1 for what identifies a control
  // (Edge outlines, the Cobalt focus ring) and for a tinted scale card's
  // border, so a highlighted card stays a card over a screen share.
  it.each([
    ["edge", "paper"],
    ["edge", "surface"],
    ["cobalt", "paper"],
    ["win-border", "paper"],
    ["draw-border", "paper"],
  ])("%s on %s is at least 3:1 in both themes", (fore, back) => {
    for (const ratio of ratios(fore, back)) {
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });

  // Rule is decoration only (dividers, empty scale cards); it is too faint
  // for either tier, which is why controls have Edge.
  it("keeps rule below the control tier, so it cannot stand in for edge", () => {
    for (const ratio of ratios("rule", "paper")) expect(ratio).toBeLessThan(3);
  });
});

describe("type scale (docs/design.md, Type)", () => {
  // [compact, wide] in px, from the 7b spec's table.
  const EXPECTED: Record<string, [number, number]> = {
    body: [16, 17],
    status: [15, 15],
    heading: [26, 30],
    card: [22, 26],
    scale: [17, 28],
    result: [17, 18],
    pill: [13, 13],
    wordmark: [14, 17],
    control: [15, 15],
    small: [14, 14],
  };

  const sizes = (block: string): Record<string, number> => {
    const found: Record<string, number> = {};
    for (const [, name, size] of block.matchAll(
      /--text-([a-z]+):\s*([\d.]+)rem/g,
    )) {
      if (name && size) found[name] = Number(size) * 16;
    }
    return found;
  };

  const wideStart = tokens.indexOf("@media (min-width: 55em)");
  const compact = sizes(tokens.slice(0, wideStart));
  const wide = { ...compact, ...sizes(tokens.slice(wideStart)) };

  it("defines exactly the roles in the table", () => {
    expect(Object.keys(compact).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))(
    "%s is %j px, compact and wide",
    (name, [compactPx, widePx]) => {
      expect([compact[name], wide[name]]).toEqual([compactPx, widePx]);
    },
  );

  it("never shrinks a size in the wide layout", () => {
    for (const name of Object.keys(compact)) {
      expect(wide[name]).toBeGreaterThanOrEqual(compact[name] ?? Infinity);
    }
  });
});

describe("the font's first frame", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const preloads = [...html.matchAll(/<link\s[^>]*rel="preload"[^>]*>/g)].map(
    ([tag]) => tag,
  );

  it("preloads the Latin face that the stylesheet declares", () => {
    const latin = preloads.find((tag) => tag.includes("figtree-latin-wght"));
    expect(latin).toBeDefined();
    // A font preload without crossorigin is fetched twice.
    expect(latin).toMatch(/as="font"/);
    expect(latin).toMatch(/type="font\/woff2"/);
    expect(latin).toMatch(/\scrossorigin[\s/>]/);
    expect(tokens).toContain("../fonts/figtree-latin-wght-normal.woff2");
  });

  it("does not preload Latin Extended, which only some names need", () => {
    expect(preloads.some((tag) => tag.includes("latin-ext"))).toBe(false);
  });
});
