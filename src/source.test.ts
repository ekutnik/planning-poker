import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * No invisible or direction-changing character anywhere in the repository's
 * text (#80): each one is written as an escape ("\u2068"), so a reviewer can
 * see it. A direction control hidden in source can make code read one way
 * and run another ("Trojan Source"), so this is a check, not a convention.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

/**
 * The repository's own files, as git tracks them: never a local file that
 * isn't committed (a report, a cache, an editor's scratch file). A file
 * deleted but not yet committed is gone already, so it is left out.
 */
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter((path) => path !== "" && existsSync(join(ROOT, path)));

/** Every text file: a file with a NUL byte is binary (the PNGs, the fonts). */
const texts = tracked.flatMap((path) => {
  const bytes = readFileSync(join(ROOT, path));
  return bytes.includes(0) ? [] : [{ path, text: bytes.toString("utf8") }];
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
