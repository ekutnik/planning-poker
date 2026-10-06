import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * No invisible or direction-changing character anywhere in the repository's
 * text (#80): each one is written as an escape ("\u2068"), so a reviewer can
 * see it. A direction control hidden in source can make code read one way
 * and run another ("Trojan Source"), so this is a check, not a convention.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// Built, installed or generated: not the repository's own text.
const SKIPPED = new Set([
  ".git",
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
]);
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Every text file: a file with a NUL byte is binary (the PNGs, the fonts). */
const texts = files(ROOT).flatMap((path) => {
  const bytes = readFileSync(path);
  return bytes.includes(0)
    ? []
    : [{ path: relative(ROOT, path), text: bytes.toString("utf8") }];
});

describe("the repository's text (#80)", () => {
  it("reads the source, the tests, the docs and the config", () => {
    const paths = new Set(texts.map(({ path }) => path));
    for (const path of [
      "src/shared/rules.ts",
      "src/web/isolate.ts",
      "e2e/names.e2e.ts",
      "docs/design.md",
      "README.md",
      ".github/workflows/ci.yml",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("holds no invisible or direction-changing character: each is an escape", () => {
    const found = texts.flatMap(({ path, text }) =>
      text
        .split("\n")
        .flatMap((line, i) =>
          [...line.matchAll(HIDDEN)].map(
            ([char]) =>
              `${path}:${String(i + 1)} U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
          ),
        ),
    );
    expect(found).toEqual([]);
  });
});
