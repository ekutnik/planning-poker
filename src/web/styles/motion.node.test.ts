import { describe, expect, it } from "vitest";
import { readStyles, split } from "./css.node.js";

const css = readStyles();

const MOTION = /\b(?:animation|transition)(?:-[a-z]+)?\s*:([^;}]*)/g;

describe("motion (docs/design.md: calm by default)", () => {
  // A reduce block only switches motion off (base.css), so it is set aside.
  const rest = split(css, "(prefers-reduced-motion: reduce)").outside;
  const { inside, outside } = split(
    rest,
    "(prefers-reduced-motion: no-preference)",
  );

  it("moves nothing for someone who asked for reduced motion", () => {
    expect([...outside.matchAll(MOTION)].map(([rule]) => rule)).toEqual([]);
  });

  it("fades every new screen in, over 150ms", () => {
    expect(inside).toMatch(
      /\.page,\s*\.round\s*\{\s*animation:\s*screen-in 150ms/,
    );
    expect(css).toMatch(
      /@keyframes screen-in\s*\{\s*from\s*\{\s*opacity:\s*0;?\s*\}/,
    );
  });

  it("has the settle, so the checks here are not vacuous", () => {
    expect(inside).toMatch(/animation:\s*settle var\(--settle\)/);
  });

  it("keeps every animation under 200 ms", () => {
    const settle = /--settle:\s*(\d+)ms/.exec(css)?.[1];
    expect(Number(settle)).toBeLessThan(200);
    for (const [, value = ""] of inside.matchAll(MOTION)) {
      for (const [, amount = "", unit] of value.matchAll(
        /(\d*\.?\d+)(ms|s)\b/g,
      )) {
        expect(Number(amount) * (unit === "s" ? 1000 : 1)).toBeLessThan(200);
      }
    }
  });
});
