import { expectAccessible } from "./axe.js";
import { expect, newRoom, row, test } from "./fixtures.js";

/**
 * axe on every screen, in the light theme and the dark (expectAccessible).
 * Three more are checked where their own tests reach them: the nudge banner
 * (nudge.e2e.ts), the restart banner and the second-tab screen
 * (recovery.e2e.ts).
 */

test("axe: the landing page, the Menu, and a link to no room", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Estimate together",
  );
  // Paused, so the preview holds one frame while axe reads the page.
  await page.getByRole("button", { name: "Pause preview" }).click();
  await expectAccessible(page, "landing");

  await page.getByRole("button", { name: "Menu" }).click();
  await expectAccessible(page, "landing, Menu open");

  await page.goto("/r/not-a-room");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "There's no room at this link.",
  );
  await expectAccessible(page, "no room at this link");
});

test("axe: joining, with a name the form refuses", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const guest = await people.open(`/r/${roomId}`);
  await expect(guest.heading).toHaveText("Join the room");
  await expectAccessible(guest.page, "join");

  await guest.page.getByLabel("Your name").fill("x".repeat(40));
  await guest.page.getByRole("button", { name: "Join" }).click();
  await expect(guest.page.getByRole("alert")).not.toBeEmpty();
  await expectAccessible(guest.page, "join, name refused");
});

for (const [layout, viewport] of [
  ["wide", { width: 1280, height: 800 }],
  ["compact", { width: 390, height: 844 }],
] as const) {
  test(`axe: the room, ${layout}: voting and revealed, both views`, async ({
    people,
    baseURL,
  }) => {
    const roomId = await newRoom(baseURL ?? "");
    const ada = await people.join(roomId, "Ada", { facilitate: true });
    const ben = await people.join(roomId, "Ben");
    await people.join(roomId, "Cy");
    for (const person of [ada, ben]) {
      await person.page.setViewportSize(viewport);
    }

    // Voting: Ada and Ben have voted, Cy has not, so Ada's view shows
    // Clear my vote, her pill and a Nudge button.
    await ben.card("5").click();
    await ada.card("8").click();
    await expect(row(ada.page, "Ben")).toContainText("Voted");
    await expect(
      ada.page.getByRole("button", { name: "Nudge Cy" }),
    ).toBeVisible();
    await expectAccessible(ada.page, `${layout} voting, facilitator`);
    await expectAccessible(ben.page, `${layout} voting, participant`);

    await ada.page.getByRole("button", { name: "Menu" }).click();
    await expectAccessible(
      ada.page,
      `${layout} voting, facilitator, Menu open`,
    );
    await ada.page.keyboard.press("Escape");

    await ada.page.getByRole("button", { name: "Reveal votes" }).click();
    for (const person of [ada, ben]) {
      await expect(person.heading).toHaveText("Votes revealed");
    }
    await expectAccessible(ada.page, `${layout} revealed, facilitator`);
    await expectAccessible(ben.page, `${layout} revealed, participant`);
  });
}

test("axe: after leaving the room", async ({ people, baseURL }) => {
  const roomId = await newRoom(baseURL ?? "");
  const ben = await people.join(roomId, "Ben");
  // From the keyboard: the heading takes focus when the screen that had it
  // goes (focus.ts). Safari doesn't focus a clicked button, so after mouse
  // clicks alone nothing had focus there, and focus is left as it was.
  await ben.page.getByRole("button", { name: "Menu" }).click();
  await ben.page.getByRole("button", { name: "Leave the room" }).focus();
  await ben.page.keyboard.press("Enter");
  await expect(ben.heading).toHaveText("You left the room.");
  await expect(ben.heading).toBeFocused();
  await expectAccessible(ben.page, "left the room");
});
