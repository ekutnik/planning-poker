import type { Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import { expect, newRoom, row, test } from "./fixtures.js";

/**
 * Keep score, from the facilitator's Menu: points at each reveal with one
 * winning card, the people list in points order, and nothing at all while
 * it is off.
 */

const names = (page: Page) =>
  page
    .getByRole("list", { name: "Participants" })
    .first()
    .locator(".person-name")
    .allInnerTexts();

test("points over two reveals, in points order, hidden and shown again", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  const cy = await people.join(roomId, "Cy");
  const page = ada.page;

  // Off by default: no points anywhere, and no switch for a participant.
  await expect(row(ben.page, "Cy")).toBeVisible();
  await expect(ben.page.locator(".person-points")).toHaveCount(0);
  await ben.page.getByRole("button", { name: "Menu" }).click();
  await expect(
    ben.page.getByRole("switch", { name: "Facilitate" }),
  ).toBeVisible();
  await expect(
    ben.page.getByRole("switch", { name: "Keep score" }),
  ).toHaveCount(0);
  await ben.page.keyboard.press("Escape");

  // Ada turns it on: everyone sees 0 pts.
  await page.getByRole("button", { name: "Menu" }).click();
  const keepScore = page.getByRole("switch", { name: "Keep score" });
  await keepScore.click();
  await expect(keepScore).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(row(ben.page, "Cy")).toContainText("0 pts");

  // Round 1: 5, 5, 8. 5 wins: Ada and Ben get a point.
  await ada.card("5").click();
  await ben.card("5").click();
  await cy.card("8").click();
  await page.getByRole("button", { name: "Reveal votes" }).click();
  await expect(row(cy.page, "Ben")).toContainText("1 pt");
  await expect(row(cy.page, "Cy")).toContainText("0 pts");
  expect(await names(cy.page)).toEqual(["Ada", "Ben", "Cy"]);

  // Round 2: 8, 3, 3. 3 wins: Ben 2, Ada 1, Cy 1; Ada before Cy, by join order.
  await page.getByRole("button", { name: "Start next round" }).click();
  await ada.card("8").click();
  await ben.card("3").click();
  await cy.card("3").click();
  await page.getByRole("button", { name: "Reveal votes" }).click();
  await expect(row(cy.page, "Ben")).toContainText("2 pts");
  expect(await names(cy.page)).toEqual(["Ben", "Ada", "Cy"]);
  await expect(row(cy.page, "Ben").locator(".visually-hidden")).toContainText(
    "2 points",
  );

  // Off: the points go, and join order is back.
  await page.getByRole("button", { name: "Menu" }).click();
  await keepScore.click();
  await expect(keepScore).toHaveAttribute("aria-checked", "false");
  await expect(row(cy.page, "Cy")).toBeVisible();
  await expect(cy.page.locator(".person-points")).toHaveCount(0);
  expect(await names(cy.page)).toEqual(["Ada", "Ben", "Cy"]);

  // On again: the same points as before.
  await keepScore.click();
  await expect(row(cy.page, "Ben")).toContainText("2 pts");
  await expect(row(cy.page, "Ada")).toContainText("1 pt");
});

test("axe: the room with points, voting and revealed", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  await ada.page.getByRole("button", { name: "Menu" }).click();
  await ada.page.getByRole("switch", { name: "Keep score" }).click();
  await ada.page.keyboard.press("Escape");
  await expect(row(ben.page, "Ada")).toContainText("0 pts");
  await expectAccessible(ben.page, "voting with points, participant");
  await expectAccessible(ada.page, "voting with points, facilitator");
  await ada.card("5").click();
  await ben.card("5").click();
  await ada.page.getByRole("button", { name: "Reveal votes" }).click();
  await expect(row(ben.page, "Ada")).toContainText("1 pt");
  await expectAccessible(ben.page, "revealed with points");
});
