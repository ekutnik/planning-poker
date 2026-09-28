import { expectAccessible } from "./axe.js";
import { expect, newRoom, row, test, type Frames } from "./fixtures.js";

const BANNER = "The room is waiting for your vote.";
const TITLE = (part: string) => `${part} – Planning Poker Session`;

/** The nudges a facilitator's browser sent. */
const nudgesSent = (frames: Frames) =>
  frames.sent.filter((frame) => frame.type === "nudge");
const nudgesReceived = (frames: Frames) =>
  frames.received.filter((frame) => frame.type === "nudged");

test("a nudge reaches only its target, and clicking Nudged sends nothing", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  const cy = await people.join(roomId, "Cy");

  // Ada nudges Ben from the keyboard. The button turns into "Nudged" and
  // keeps focus: it is aria-disabled, not disabled.
  const nudgeBen = ada.page.getByRole("button", { name: "Nudge Ben" });
  await nudgeBen.focus();
  await ada.page.keyboard.press("Enter");
  const nudgedBen = ada.page.getByRole("button", { name: "Nudged Ben" });
  await expect(nudgedBen).toBeFocused();
  await expect(nudgedBen).toHaveAttribute("aria-disabled", "true");

  // Only Ben hears about it: the banner and the tab title ask for his vote.
  await expect(ben.page.getByText(BANNER)).toBeVisible();
  await expect(ben.page).toHaveTitle(TITLE("Your vote, please"));
  await expect
    .poll(() => nudgesReceived(ben.frames))
    .toEqual([{ type: "nudged" }]);
  await expectAccessible(ben.page, "room, nudged");

  // Clicking "Nudged", and pressing Enter on it, send nothing more. Ada
  // then votes: messages arrive in order, so once her vote is counted, a
  // second nudge would have been sent before it.
  // force: Playwright waits for an aria-disabled button to become enabled;
  // this is still a real mouse click at the button.
  await nudgedBen.click({ force: true });
  await nudgedBen.focus();
  await ada.page.keyboard.press("Enter");
  await ada.card("3").click();
  await expect(row(cy.page, "Ada")).toContainText("Voted");
  expect(nudgesSent(ada.frames)).toEqual([
    { type: "nudge", participantId: expect.any(String) },
  ]);
  expect(nudgesReceived(cy.frames)).toEqual([]);
  expect(nudgesReceived(ada.frames)).toEqual([]);
  await expect(cy.page.getByText(BANNER)).toHaveCount(0);
  await expect(cy.page).not.toHaveTitle(TITLE("Your vote, please"));

  // Ben votes: his banner and title clear, and Ada's button for him goes.
  // It had focus, so focus moves to the people list, not to the page.
  await nudgedBen.focus();
  await ben.card("5").click();
  await expect(ben.page.getByText(BANNER)).toHaveCount(0);
  await expect(ben.page).toHaveTitle(TITLE("1 waiting"));
  await expect(nudgedBen).toHaveCount(0);
  await expect(
    ada.page.getByRole("list", { name: "Participants" }),
  ).toBeFocused();
});

test("the Nudge button comes back after 30 seconds", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", {
    facilitate: true,
    beforeOpen: (page) => page.clock.install(),
  });
  await people.join(roomId, "Ben");

  await ada.page.getByRole("button", { name: "Nudge Ben" }).click();
  const nudged = ada.page.getByRole("button", { name: "Nudged Ben" });
  await expect(nudged).toBeVisible();
  await ada.page.clock.fastForward(29_000);
  await expect(nudged).toBeVisible();
  await ada.page.clock.fastForward(1_000);
  await expect(
    ada.page.getByRole("button", { name: "Nudge Ben" }),
  ).toBeVisible();
});
