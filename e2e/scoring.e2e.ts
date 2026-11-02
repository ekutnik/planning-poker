import type { Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import { expect, newRoom, row, test, type Person } from "./fixtures.js";

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

test("points outlast a seat: Leave the room and back restores them, in points order; another browser starts at 0 (ADR 0012)", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  const cy = await people.join(roomId, "Cy");
  const page = ada.page;
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("switch", { name: "Keep score" }).click();
  await page.keyboard.press("Escape");
  const round = async (votes: readonly [Person, string][]) => {
    for (const [person, card] of votes) await person.card(card).click();
    for (const [person] of votes) {
      await expect(row(page, person.name).getByText("Voted")).toBeVisible();
    }
    await page.getByRole("button", { name: "Reveal votes" }).click();
    await page.getByRole("button", { name: "Start next round" }).click();
    await expect(
      page.getByRole("button", { name: "Reveal votes" }),
    ).toBeVisible();
  };

  // Ben 2, Ada 1, Cy 1: Ben first, the tie in join order.
  await round([
    [ben, "5"],
    [cy, "5"],
  ]);
  await round([
    [ada, "8"],
    [ben, "8"],
    [cy, "3"],
  ]);
  await expect(row(page, "Ben").getByText("2 pts")).toBeVisible();
  expect(await names(page)).toEqual(["Ben", "Ada", "Cy"]);

  // Ben leaves: he's off the list, and nobody else's points move.
  await ben.page.getByRole("button", { name: "Menu" }).click();
  await ben.page.getByRole("button", { name: "Leave the room" }).click();
  await expect(row(page, "Ben")).toHaveCount(0);
  expect(await names(page)).toEqual(["Ada", "Cy"]);

  // Someone else called Ben, in another browser, starts at 0.
  const other = await people.join(roomId, "Ben");
  await expect(row(page, "Ben").getByText("0 pts")).toBeVisible();
  expect(await names(page)).toEqual(["Ada", "Cy", "Ben"]);
  await other.page.getByRole("button", { name: "Menu" }).click();
  await other.page.getByRole("button", { name: "Leave the room" }).click();
  await expect(row(page, "Ben")).toHaveCount(0);

  // The same browser, back on the same link: his points, and his place.
  await ben.page.goto(`/r/${roomId}`);
  await expect(row(page, "Ben").getByText("2 pts")).toBeVisible();
  expect(await names(page)).toEqual(["Ben", "Ada", "Cy"]);
});
