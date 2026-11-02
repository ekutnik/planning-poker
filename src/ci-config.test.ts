import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * CI's e2e job runs in Playwright's own image (#114), which carries the
 * browsers for one Playwright version only. If package-lock.json moves to
 * another version and the image doesn't, the suite would look for browsers
 * the image hasn't got: this holds the two together, so an upgrade changes
 * both in one PR.
 */

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const lock = JSON.parse(read("package-lock.json")) as {
  packages: Record<string, { version?: string } | undefined>;
};
const ci = read(".github/workflows/ci.yml");

describe("CI's e2e job (#114)", () => {
  const image =
    /container:\s*\n\s*image: mcr\.microsoft\.com\/playwright:v([\d.]+)-noble\n/.exec(
      ci,
    );

  it("runs in Playwright's image, at the version package-lock.json locks", () => {
    expect(image).not.toBeNull();
    expect(image?.[1]).toBe(lock.packages["node_modules/playwright"]?.version);
    expect(image?.[1]).toBe(
      lock.packages["node_modules/@playwright/test"]?.version,
    );
  });

  it("installs no browsers and nothing from Ubuntu's mirror", () => {
    expect(ci).not.toMatch(/playwright install/);
    expect(ci).not.toMatch(/apt-get/);
  });

  it("has a time limit, so a step that hangs fails", () => {
    const e2e = /\n {2}e2e:\n([\s\S]*?)\n {2}\S/.exec(ci)?.[1] ?? "";
    const minutes = Number(/timeout-minutes: (\d+)/.exec(e2e)?.[1]);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(30);
  });
});
