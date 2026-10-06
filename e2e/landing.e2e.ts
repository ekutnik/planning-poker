import { expect, tabKey, test } from "./fixtures.js";

test("the landing preview plays on its own, and Pause stops it on the frame showing", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  const status = page.locator(
    ".preview-frame:not(.preview-frame--sizer) .preview-status",
  );
  const first = await status.textContent();
  await page.clock.runFor(2_000); // the first frame's time
  await expect(status).not.toHaveText(first ?? "");

  // Paused: the same frame, however long it waits.
  await page.getByRole("button", { name: "Pause preview" }).click();
  await expect(
    page.getByRole("button", { name: "Play preview" }),
  ).toBeVisible();
  const paused = (await status.textContent()) ?? "";
  await page.clock.runFor(10_000);
  await expect(status).toHaveText(paused);

  await page.getByRole("button", { name: "Play preview" }).click();
  await page.clock.runFor(2_000);
  await expect(status).not.toHaveText(paused);
});

test("nothing in the landing preview takes focus or a click", async ({
  page,
}) => {
  await page.goto("/");
  const preview = page.locator(".preview-room");
  await expect(preview).toHaveAttribute("inert", "");
  await expect(preview).toHaveAttribute("aria-hidden", "true");

  // Tab through the whole page: focus never lands inside the preview.
  await page.getByLabel("Your name").focus();
  const visited: string[] = [];
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press(tabKey(page));
    visited.push(
      await page.evaluate(() => {
        const active = document.activeElement;
        if (active?.closest(".preview-room")) return "INSIDE THE PREVIEW";
        return active?.getAttribute("aria-label") ?? active?.textContent ?? "";
      }),
    );
  }
  expect(visited).not.toContain("INSIDE THE PREVIEW");
  expect(visited).toContain("Pause preview");

  // A real click on one of its cards does nothing.
  const card = preview.locator(".card").first();
  const box = await card.boundingBox();
  if (box === null) throw new Error("the preview's card is not on screen");
  const before = await card.getAttribute("aria-pressed");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await card.getAttribute("aria-pressed")).toBe(before);
  expect(
    await page.evaluate(
      () => document.activeElement?.closest(".preview-room") ?? null,
    ),
  ).toBeNull();
});

test("says how long to wait when the server's limit refuses a room (ADR 0009)", async ({
  page,
}) => {
  // The suite's server raises the limits, so the refusal is the server's
  // answer played back: 429, with 90 s to wait.
  await page.route("**/api/rooms", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "90" },
      contentType: "application/json",
      body: JSON.stringify({ error: "RATE_LIMITED" }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Your name").fill("Ada");
  await page.getByRole("button", { name: "Create a room" }).click();
  // Rounded up to whole minutes.
  await expect(page.getByRole("alert")).toHaveText(
    "Too many rooms were made from your network just now. Try again in 2 minutes.",
  );
  await expect(page).toHaveURL(/\/$/);
});
