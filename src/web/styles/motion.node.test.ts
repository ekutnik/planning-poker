import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

// Read from disk: Vitest turns every CSS import into an empty string.
const dir = new URL("./", import.meta.url);
const css = [
  ...readdirSync(dir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => new URL(file, dir)),
  new URL("../index.css", import.meta.url),
]
  .map((url) => readFileSync(url, "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** The CSS split into what is inside `@media <query>` blocks, and the rest. */
function split(
  source: string,
  query: string,
): { inside: string; outside: string } {
  const at = `@media ${query}`;
  let inside = "";
  let outside = "";
  let from = 0;
  for (
    let start = source.indexOf(at);
    start !== -1;
    start = source.indexOf(at, from)
  ) {
    outside += source.slice(from, start);
    let end = source.indexOf("{", start);
    let depth = 0;
    do {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    } while (depth > 0 && end < source.length);
    inside += source.slice(start, end);
    from = end;
  }
  return { inside, outside: outside + source.slice(from) };
}

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
