import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Read from disk: Vitest turns every CSS import into an empty string.
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** Every colour token, as [light, dark], parsed from light-dark(). */
function colours(): Record<string, [string, string]> {
  const found: Record<string, [string, string]> = {};
  const pattern =
    /--([a-z-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi;
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

describe("colour tokens", () => {
  const palette = colours();

  it("defines every colour for both themes", () => {
    expect(Object.keys(palette).sort()).toEqual(
      ["agree", "cobalt", "discuss", "edge", "ink", "paper", "rule"].sort(),
    );
  });

  const onPaper = (name: string): [number, number] => {
    const [light, dark] = palette[name] ?? ["", ""];
    const [paperLight, paperDark] = palette.paper ?? ["", ""];
    return [contrast(light, paperLight), contrast(dark, paperDark)];
  };

  // Tier 1, meaning: everything that carries meaning must read over a
  // compressed screen share, so WCAG AA for normal text, in both themes.
  it.each(["ink", "cobalt", "agree", "discuss"])(
    "%s is at least 4.5:1 on paper in both themes",
    (name) => {
      for (const ratio of onPaper(name)) {
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  // Tier 2, control boundaries: WCAG 1.4.11 needs 3:1 for what identifies a
  // control, such as a card's outline (Edge) and the focus ring (Cobalt).
  it.each(["edge", "cobalt"])(
    "%s is at least 3:1 on paper in both themes",
    (name) => {
      for (const ratio of onPaper(name)) {
        expect(ratio).toBeGreaterThanOrEqual(3);
      }
    },
  );

  // Rule is decoration only (dividers, empty states); it is too faint for
  // either tier, which is why cards have Edge.
  it("keeps rule below the control tier, so it cannot stand in for edge", () => {
    for (const ratio of onPaper("rule")) expect(ratio).toBeLessThan(3);
  });

  // A selected card is a Cobalt fill with a Paper numeral.
  it("reads a paper numeral on a cobalt fill at 4.5:1 in both themes", () => {
    const [cobaltLight, cobaltDark] = palette.cobalt ?? ["", ""];
    const [paperLight, paperDark] = palette.paper ?? ["", ""];
    expect(contrast(paperLight, cobaltLight)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paperDark, cobaltDark)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("type scale", () => {
  const sizes = (block: string): Record<string, number> => {
    const found: Record<string, number> = {};
    for (const [, name, size] of block.matchAll(
      /--text-([a-z]+):\s*([\d.]+)rem/g,
    )) {
      if (name && size) found[name] = Number(size);
    }
    return found;
  };

  it("grows every size in the wide layout, for a screen-share thumbnail", () => {
    const wideStart = tokens.indexOf("@media (min-width: 55em)");
    const compact = sizes(tokens.slice(0, wideStart));
    const wide = sizes(tokens.slice(wideStart));
    expect(Object.keys(wide).sort()).toEqual(Object.keys(compact).sort());
    for (const name of Object.keys(compact)) {
      expect(wide[name]).toBeGreaterThan(compact[name] ?? Infinity);
    }
  });
});
