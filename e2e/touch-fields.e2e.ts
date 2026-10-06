import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, newRoom, test, watch } from "./fixtures.js";

/*
 * 16px fields on touch screens (#86). iOS and iPadOS Safari zoom the page
 * when a field with smaller text gets focus, at any width, so with touch
 * every field in every state that shows one is 16px at least: on a phone,
 * and on an iPad in landscape, with the wide layout. Without touch, the
 * desktop keeps its sizes.
 */

/** A browser of its own, with touch or without, at this size. */
async function open(
  browser: Browser,
  baseURL: string,
  hasTouch: boolean,
  width: number,
  problems: string[],
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL,
    hasTouch,
    viewport: { width, height: 800 },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: "planning-poker:facilitate:v2", value: "on" },
            {
              name: "planning-poker:tools:v1",
              value: JSON.stringify({ ticket: true, timer: true }),
            },
          ],
        },
      ],
    },
  });
  await watch(context, problems);
  return { context, page: await context.newPage() };
}

/** Every field on screen, by its label, and its text's computed size in px. */
function fieldSizes(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [
        ...document.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >("input, select, textarea"),
      ]
        .filter((field) => field.getBoundingClientRect().height > 0)
        .map((field) => [
          field.labels?.[0]?.textContent?.trim() ??
            field.getAttribute("aria-label") ??
            field.name,
          Number.parseFloat(getComputedStyle(field).fontSize),
        ]),
    ),
  );
}

/**
 * Goes through every state that shows a field, and returns each field's
 * size as seen in it: the name, the ticket being edited, the duration
 * select, the custom time, and the Menu's Theme select.
 */
async function everyField(page: Page, baseURL: string) {
  const seen: Record<string, number> = {};
  const look = async () => Object.assign(seen, await fieldSizes(page));

  // Joining: a room link in a browser with no name yet.
  const roomId = await newRoom(baseURL);
  await page.goto(`/r/${roomId}`);
  await look();
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Join" }).click();

  await page.getByRole("button", { name: "Add a ticket" }).click();
  await expect(page.getByLabel("Now estimating")).toBeVisible();
  await look();
  await page.getByRole("button", { name: "Cancel" }).click();

  const select = page.getByRole("combobox", { name: "Timer" });
  await expect(select).toBeVisible();
  await select.selectOption("custom");
  await expect(page.getByLabel("Custom time")).toBeVisible();
  await look();

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByLabel("Theme")).toBeVisible();
  await look();
  return seen;
}

const FIELDS = ["Your name", "Now estimating", "Timer", "Custom time", "Theme"];

for (const width of [390, 1180]) {
  test(`with touch at ${String(width)}px, every field is 16px at least, in every state that shows one`, async ({
    browser,
    baseURL,
  }) => {
    const problems: string[] = [];
    const { context, page } = await open(
      browser,
      baseURL ?? "",
      true,
      width,
      problems,
    );
    expect(
      await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches),
    ).toBe(true);
    const seen = await everyField(page, baseURL ?? "");
    // Not by stopping zoom: that would fail WCAG 1.4.4.
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1",
    );
    expect(Object.keys(seen).sort()).toEqual([...FIELDS].sort());
    for (const [field, size] of Object.entries(seen)) {
      expect({ field, atLeast16: size >= 16 }).toEqual({
        field,
        atLeast16: true,
      });
    }
    expect(problems).toEqual([]);
    await context.close();
  });
}

test("without touch at 1280px, the fields keep the desktop's sizes", async ({
  browser,
  baseURL,
}) => {
  const problems: string[] = [];
  const { context, page } = await open(
    browser,
    baseURL ?? "",
    false,
    1280,
    problems,
  );
  expect(
    await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches),
  ).toBe(false);
  expect(await everyField(page, baseURL ?? "")).toEqual({
    "Your name": 17,
    "Now estimating": 16,
    Timer: 13,
    "Custom time": 13,
    Theme: 15,
  });
  expect(problems).toEqual([]);
  await context.close();
});
