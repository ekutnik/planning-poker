import type { Page } from "@playwright/test";
import { expect, newRoom, test } from "./fixtures.js";

/**
 * The Facilitate view is off until someone turns it on: a browser that never
 * chose, or chose before v0.2.1 under the old key, gets the participant view
 * and sees its own vote on the deck.
 */

const facilitating = (page: Page) =>
  page.getByText("Facilitating", { exact: true });

test("a fresh browser creates a room in the participant view", async ({
  people,
}) => {
  const ada = await people.open("/", { name: null });
  await ada.page.getByLabel("Your name").fill("Ada");
  await expect(
    ada.page.getByRole("switch", { name: "I'm running this session" }),
  ).toHaveAttribute("aria-checked", "false");
  await ada.page.getByRole("button", { name: "Create a room" }).click();
  // The participant view counts; the facilitator's would name who is missing.
  await expect(ada.heading).toHaveText("0 of 1 have voted");
  await ada.card("5").click();
  await expect(ada.card("5")).toHaveAttribute("aria-pressed", "true");
  await expect(facilitating(ada.page)).not.toBeVisible();
});

test("a fresh browser that joins sees its own vote highlighted on the deck", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ben = await people.join(roomId, "Ben");
  await ben.card("8").click();
  await expect(ben.card("8")).toHaveAttribute("aria-pressed", "true");
  await expect(facilitating(ben.page)).not.toBeVisible();
});

test("a Facilitate saved under the old key no longer applies", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const cy = await people.join(roomId, "Cy", {
    beforeOpen: async (page) => {
      await page.addInitScript(() => {
        localStorage.setItem("planning-poker:facilitate", "on");
      });
    },
  });
  await cy.card("3").click();
  await expect(cy.card("3")).toHaveAttribute("aria-pressed", "true");
  await expect(facilitating(cy.page)).not.toBeVisible();
});
