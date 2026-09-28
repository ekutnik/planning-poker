import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

declare global {
  interface Window {
    /** Set by the init script below: the theme as <html> changed. */
    __e2eTheme?: { theme: string | null; scheme: string; body: boolean }[];
  }
}

/**
 * Records every change to <html>'s data-theme and color-scheme from the
 * very start of the page, noting whether <body> existed yet. Nothing in
 * the page can paint before <body> exists, so a change recorded without it
 * was applied before the first paint.
 */
async function watchTheme(page: Page) {
  await page.addInitScript(() => {
    const changes: NonNullable<Window["__e2eTheme"]> = [];
    window.__e2eTheme = changes;
    // <html> may not exist yet when this runs: watch the whole document.
    new MutationObserver((records) => {
      const root = document.documentElement;
      if (!records.some((record) => record.target === root)) return;
      changes.push({
        theme: root.getAttribute("data-theme"),
        scheme: root.style.colorScheme,
        body: document.body !== null,
      });
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });
  });
}

const changes = (page: Page) => page.evaluate(() => window.__e2eTheme ?? []);

for (const [stored, system] of [
  ["dark", "light"],
  ["light", "dark"],
] as const) {
  test(`a stored ${stored} theme is applied before the first paint, on a ${system} system`, async ({
    people,
  }) => {
    const person = await people.open("about:blank", { theme: stored });
    await person.page.emulateMedia({ colorScheme: system });
    await watchTheme(person.page);
    await person.page.goto("/");
    await expect(person.heading).toHaveText("Estimate together");
    const [first] = await changes(person.page);
    expect(first).toEqual({ theme: stored, scheme: stored, body: false });
  });
}

test("with no stored theme the page follows the system, and a choice in the Menu is kept", async ({
  page,
}) => {
  await watchTheme(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await changes(page)).toEqual([]);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  const [first] = await changes(page);
  expect(first).toEqual({ theme: "dark", scheme: "dark", body: false });
});
