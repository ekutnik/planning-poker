import { expect, newRoom, tabKey, test } from "./fixtures.js";

test("facilitator view: Clear my vote moves focus to the first card", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  await ada.card("8").click();
  const clear = ada.page.getByRole("button", { name: "Clear my vote" });
  await clear.focus();
  await ada.page.keyboard.press("Enter");
  await expect(clear).toHaveCount(0);
  await expect(ada.card("0")).toBeFocused();
  await expect(ada.page.getByText("You've voted")).toHaveCount(0);
});

test("facilitator view: after a click on a card, the deck's Tab stop is the first card", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  // The deck never marks the hidden vote, so it can't be the Tab stop
  // either: returning with Tab lands on the first card, not the one chosen.
  await ada.card("13").click();
  await expect(ada.page.getByText("You've voted")).toBeVisible();
  await ada.card("13").focus();
  await ada.page.keyboard.press(tabKey(ada.page)); // out of the deck
  await expect(
    ada.page.getByRole("button", { name: "Clear my vote" }),
  ).toBeFocused();
  await ada.page.keyboard.press(tabKey(ada.page, true));
  await expect(ada.card("0")).toBeFocused();
  await expect(ada.card("13")).toHaveAttribute("tabindex", "-1");
});

test("the Menu: closes on Escape, a click outside and focus leaving; stays open while its settings change", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada");
  const page = ada.page;
  const menu = page.getByRole("button", { name: "Menu" });
  const facilitate = page.getByRole("switch", { name: "Facilitate" });
  const theme = page.getByLabel("Theme");

  // Open it, change both settings: it stays open, and each takes effect.
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await facilitate.click();
  await expect(page.getByText("Facilitating", { exact: true })).toBeVisible();
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(facilitate).toBeVisible();

  // Escape closes it and puts focus back on its button.
  await facilitate.focus();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();

  // A click outside closes it.
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await ada.heading.click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  // So does focus leaving it: Tab past the last control in the panel.
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Leave the room" }).focus();
  await page.keyboard.press(tabKey(page));
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});
