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
      ["agree", "cobalt", "discuss", "ink", "paper", "rule"].sort(),
    );
  });

  // Everything that carries meaning must read over a compressed screen share:
  // WCAG AA for normal text, on Paper, in both themes. Rule carries no
  // meaning (outlines and dividers only), so it is not held to this.
  it.each(["ink", "cobalt", "agree", "discuss"])(
    "%s is at least 4.5:1 on paper in both themes",
    (name) => {
      const [light, dark] = palette[name] ?? ["", ""];
      const [paperLight, paperDark] = palette.paper ?? ["", ""];
      expect(contrast(light, paperLight)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark, paperDark)).toBeGreaterThanOrEqual(4.5);
    },
  );
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
