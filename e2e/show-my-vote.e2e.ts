import type { Page } from "@playwright/test";
import { expect, newRoom, test } from "./fixtures.js";

/**
 * Show my vote, facilitator view: hidden until pressed, never on the deck,
 * and hidden again by a new round, Clear my vote, switching Facilitate and a
 * reload.
 */

const ownVote = (page: Page) => page.locator(".own-vote .pill");
const showButton = (page: Page) =>
  page.getByRole("button", { name: "Show my vote" });
const hideButton = (page: Page) =>
  page.getByRole("button", { name: "Hide my vote" });
const deckSelection = (page: Page) =>
  page
    .getByRole("toolbar", { name: "Your card" })
    .locator('[aria-pressed="true"]');

test("the facilitator can show their own vote, and it hides itself again", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  const page = ada.page;

  // Hidden: the page shows no vote value, only that a vote exists.
  await ada.card("8").click();
  await expect(ownVote(page)).toHaveText("You've voted");
  await expect(page.getByText(/Your vote:/)).toHaveCount(0);
  await expect(deckSelection(page)).toHaveCount(0);

  // Shown: the value appears, focus stays on the button, the deck is unmarked.
  // From the keyboard: Safari doesn't focus a button on a mouse click.
  const pillLeft = async () => (await ownVote(page).boundingBox())?.x;
  const before = await pillLeft();
  await showButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(ownVote(page)).toHaveText("Your vote: 8");
  await expect(hideButton(page)).toBeFocused();
  await expect(deckSelection(page)).toHaveCount(0);
  expect(await pillLeft()).toBe(before); // the pill didn't shift
  // Only on this screen: Ben's page never learns it.
  await expect(ben.page.getByText("Your vote: 8")).toHaveCount(0);

  // Hide my vote hides it, and focus stays again.
  await page.keyboard.press("Enter");
  await expect(ownVote(page)).toHaveText("You've voted");
  await expect(showButton(page)).toBeFocused();

  // A new round hides it.
  await showButton(page).click();
  await expect(ownVote(page)).toHaveText("Your vote: 8");
  await page.getByRole("button", { name: "Reveal votes" }).click();
  await page.getByRole("button", { name: "Start next round" }).click();
  await ada.card("5").click();
  await expect(ownVote(page)).toHaveText("You've voted");

  // Clear my vote hides it.
  await showButton(page).click();
  await expect(ownVote(page)).toHaveText("Your vote: 5");
  await page.getByRole("button", { name: "Clear my vote" }).click();
  await ada.card("3").click();
  await expect(ownVote(page)).toHaveText("You've voted");

  // Switching Facilitate off and on hides it.
  await showButton(page).click();
  await expect(ownVote(page)).toHaveText("Your vote: 3");
  const menu = page.getByRole("button", { name: "Menu" });
  const facilitate = page.getByRole("switch", { name: "Facilitate" });
  await menu.click();
  await facilitate.click();
  await expect(facilitate).toHaveAttribute("aria-checked", "false");
  await facilitate.click();
  await expect(facilitate).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(ownVote(page)).toHaveText("You've voted");

  // A reload hides it: it is never stored.
  await showButton(page).click();
  await expect(ownVote(page)).toHaveText("Your vote: 3");
  await page.reload();
  await expect(ownVote(page)).toHaveText("You've voted");
  await expect(page.getByText(/Your vote:/)).toHaveCount(0);
});

test("shows ☕ and ? as themselves, spoken in words", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const page = ada.page;
  await ada.card("☕").click();
  await showButton(page).click();
  await expect(ownVote(page)).toContainText("☕");
  await expect(ownVote(page).locator(".visually-hidden")).toHaveText("coffee");
  await ada.card("?").click();
  await expect(ownVote(page).locator(".visually-hidden")).toHaveText(
    "question mark",
  );
});
