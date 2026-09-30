import type { Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import { expect, newRoom, recordSpeech, spoken, test } from "./fixtures.js";

/**
 * The timer (ADR 0008), with a real 10 s timer on the real server: the
 * facilitator sets and starts it, everyone sees it count down, a pause holds
 * it, and at its deadline the server reveals the votes for everyone.
 */

const line = (page: Page) => page.locator(".timer--line");

test("a custom 10 s timer, paused and resumed, reveals the votes in two browsers", async ({
  people,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  await recordSpeech(ada.page);
  await recordSpeech(ben.page);
  const page = ada.page;

  // Idle: Ben sees nothing of it; Ada has the duration and Start.
  await expect(ben.heading).toHaveText("0 of 2 have voted");
  await expect(line(ben.page)).toHaveCount(0);
  const select = page.getByLabel("Timer", { exact: true });
  await expect(select).toHaveValue("60000");

  // Custom 0:10, then Start from the keyboard: focus stays on the button,
  // which is now Pause.
  await select.selectOption("custom");
  const custom = page.getByLabel("Custom time");
  await expect(custom).toBeFocused();
  await custom.fill("0:10");
  await custom.press("Enter");
  const start = page.getByRole("button", { name: "Start" });
  await start.focus();
  await page.keyboard.press("Enter");
  const pause = page.getByRole("button", { name: "Pause the timer" });
  await expect(pause).toBeFocused();

  // Everyone sees it, and hears it start, once.
  await expect(line(ben.page)).toContainText("left, then votes are revealed");
  await expect
    .poll(() => spoken(ben.page))
    .toEqual(["Timer started: 10 seconds."]);

  await ada.card("5").click();
  await ben.card("5").click();

  // Pause holds it: 3 s later it is still paused, and still voting.
  await pause.focus(); // voting moved focus to the card
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Resume the timer" }),
  ).toBeFocused();
  await expect(line(ben.page)).toContainText("Paused at 0:");
  const held = await line(ben.page).innerText();
  await page.waitForTimeout(3_000);
  await expect(line(ben.page)).toHaveText(held);
  await expect(ben.heading).toHaveText("Everyone has voted");

  // Resume carries on, and at the deadline the server reveals, for both.
  await page.keyboard.press("Enter");
  await expect(pause).toBeFocused();
  for (const person of [ada, ben]) {
    await expect(person.heading).toHaveText("Votes revealed", {
      timeout: 15_000,
    });
  }
  // Ben's focus was on his card, which went with the voting screen, so it
  // moved to the new heading, "Votes revealed", and the region adds the rest.
  await expect(ben.heading).toBeFocused();
  await expect
    .poll(() => spoken(ben.page))
    .toEqual(["Timer started: 10 seconds.", "Time's up. Everyone chose 5."]);

  // The next round: the timer is idle again, its 0:10 kept.
  await page.getByRole("button", { name: "Start next round" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByLabel("Custom time")).toHaveValue("0:10");
  await expect(line(ben.page)).toHaveCount(0);
});

test("+30 s adds to what is left", async ({ people, baseURL }) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const page = ada.page;
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".timer-time")).toHaveText(/^(1:00|0:59)$/);
  await page.getByRole("button", { name: "Add 30 seconds" }).click();
  await expect(page.locator(".timer-time")).toHaveText(/^(1:30|1:29)$/);
});

test("axe: the timer idle, running and paused, and a participant's line", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  await expectAccessible(ada.page, "timer, idle");
  await ada.page.getByRole("button", { name: "Start" }).click();
  await expect(line(ben.page)).toBeVisible();
  await expectAccessible(ada.page, "timer, running");
  await expectAccessible(ben.page, "timer line, participant");
  await ada.page.getByRole("button", { name: "Pause the timer" }).click();
  await expect(line(ben.page)).toContainText("Paused at");
  await expectAccessible(ada.page, "timer, paused");
});
