import type { Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import { expect, newRoom, recordSpeech, spoken, test } from "./fixtures.js";

/**
 * The ticket slot, first in the action row: the facilitator (with the
 * Menu's Ticket name on) adds and edits it in place, everyone sees it, and a
 * change by someone else is said once.
 */

const ticketText = (page: Page) => page.locator(".ticket-text");
const nowEstimating = (page: Page) =>
  page.getByText("Now estimating", { exact: true });

test("the facilitator sets a ticket, and everyone sees it", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true },
  });
  const ben = await people.join(roomId, "Ben");
  await recordSpeech(ada.page);
  await recordSpeech(ben.page);

  // No ticket: Ben sees nothing of it, Ada sees Add a ticket.
  await expect(
    ada.page.getByRole("button", { name: "Add a ticket" }),
  ).toBeVisible();
  await expect(ben.heading).toHaveText("0 of 2 have voted");
  await expect(nowEstimating(ben.page)).toHaveCount(0);

  // Add it: the field is labelled, Enter saves, focus lands on Edit.
  await ada.page.getByRole("button", { name: "Add a ticket" }).click();
  const field = ada.page.getByLabel("Now estimating");
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("maxlength", "120");
  await field.fill("PROJ-482 Admins can sign in with SSO");
  await field.press("Enter");
  await expect(ticketText(ada.page)).toHaveText(
    "PROJ-482 Admins can sign in with SSO",
  );
  await expect(
    ada.page.getByRole("button", { name: "Edit the ticket" }),
  ).toBeFocused();

  // Ben sees it, and hears it once; Ada, who typed it, hears nothing.
  await expect(ticketText(ben.page)).toHaveText(
    "PROJ-482 Admins can sign in with SSO",
  );
  await expect
    .poll(() => spoken(ben.page))
    .toEqual(["Now estimating: PROJ-482 Admins can sign in with SSO"]);
  expect(await spoken(ada.page)).toEqual([]);
  await expect(ben.page.getByRole("button", { name: /Edit/ })).toHaveCount(0);

  // Escape cancels: nothing changes, and focus goes back to Edit.
  await ada.page.getByRole("button", { name: "Edit the ticket" }).click();
  await field.fill("Something else");
  await field.press("Escape");
  await expect(ticketText(ada.page)).toHaveText(
    "PROJ-482 Admins can sign in with SSO",
  );
  await expect(
    ada.page.getByRole("button", { name: "Edit the ticket" }),
  ).toBeFocused();

  // It stays across a reveal and Start next round.
  await ada.card("5").click();
  await ada.page.getByRole("button", { name: "Reveal votes" }).click();
  await expect(ticketText(ben.page)).toHaveText(
    "PROJ-482 Admins can sign in with SSO",
  );
  await ada.page.getByRole("button", { name: "Start next round" }).click();
  await expect(ada.heading).toHaveText("Waiting for Ada and Ben");
  await expect(ticketText(ben.page)).toHaveText(
    "PROJ-482 Admins can sign in with SSO",
  );

  // Cleared with Save on an empty field: gone for Ben, Add a ticket for Ada.
  await ada.page.getByRole("button", { name: "Edit the ticket" }).click();
  await field.fill("");
  await ada.page.getByRole("button", { name: "Save" }).click();
  await expect(
    ada.page.getByRole("button", { name: "Add a ticket" }),
  ).toBeFocused();
  await expect(nowEstimating(ben.page)).toHaveCount(0);
});

test("a ticket is cleaned, shown as typed, and kept to one line, whole in its title", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true },
  });
  const ben = await people.join(roomId, "Ben");

  await ada.page.getByRole("button", { name: "Add a ticket" }).click();
  await ada.page.getByLabel("Now estimating").fill("  <b>x</b>   &  more ");
  await ada.page.getByLabel("Now estimating").press("Enter");
  await expect(ticketText(ben.page)).toHaveText("<b>x</b> & more");
  await expect(ben.page.locator(".ticket-text b")).toHaveCount(0);

  // 120 characters, on a wide screen and on a phone: one line, cut short
  // with "…", the whole text in its title and its accessible name. With
  // no space to break at, the page never scrolls sideways either.
  const long = `PROJ-482 ${"Admins can sign in with SSO ".repeat(4)}`.slice(
    0,
    111,
  );
  for (const text of [long, "W".repeat(120)]) {
    await ada.page.getByRole("button", { name: "Edit the ticket" }).click();
    await ada.page.getByLabel("Now estimating").fill(text);
    await ada.page.getByLabel("Now estimating").press("Enter");
    for (const size of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await ben.page.setViewportSize(size);
      const shown = ticketText(ben.page);
      await expect(shown).toHaveText(text.trim());
      await expect(shown).toHaveAttribute("title", text.trim());
      // A screen reader reads the paragraph whole: "…" is only drawn.
      await expect(shown).toMatchAriaSnapshot(
        `- paragraph: ${JSON.stringify(text.trim())}`,
      );
      const { lines, cut, ellipsis } = await shown.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          lines: Math.round(
            element.getBoundingClientRect().height /
              Number.parseFloat(style.lineHeight),
          ),
          cut: element.scrollWidth > element.clientWidth,
          ellipsis: style.textOverflow,
        };
      });
      expect([lines, cut, ellipsis]).toEqual([1, true, "ellipsis"]);
      expect(
        await ben.page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("switching Ticket name off clears the ticket for everyone", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true },
  });
  const ben = await people.join(roomId, "Ben");
  await ada.page.getByRole("button", { name: "Add a ticket" }).click();
  await ada.page.getByLabel("Now estimating").fill("PROJ-482");
  await ada.page.getByLabel("Now estimating").press("Enter");
  await expect(ticketText(ben.page)).toHaveText("PROJ-482");

  await ada.page.getByRole("button", { name: "Menu" }).click();
  await ada.page.getByRole("switch", { name: "Ticket name" }).click();
  await expect(
    ada.page.getByRole("switch", { name: "Ticket name" }),
  ).toHaveAttribute("aria-checked", "false");
  // Gone for Ben, and Ada has no ticket controls left.
  await expect(ben.heading).toHaveText("0 of 2 have voted");
  await expect(nowEstimating(ben.page)).toHaveCount(0);
  await expect(nowEstimating(ada.page)).toHaveCount(0);
  await expect(
    ada.page.getByRole("button", { name: /Add a ticket|Edit/ }),
  ).toHaveCount(0);
  expect(
    ada.frames.sent.filter((frame) => frame.type === "setTicket").at(-1),
  ).toEqual({ type: "setTicket", text: "" });
});

test("axe: the room with a ticket, and while editing it", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true },
  });
  const ben = await people.join(roomId, "Ben");
  await ada.page.getByRole("button", { name: "Add a ticket" }).click();
  await ada.page
    .getByLabel("Now estimating")
    .fill("PROJ-482 Admins can sign in");
  await ada.page.getByLabel("Now estimating").press("Enter");
  await expect(ticketText(ben.page)).toHaveText("PROJ-482 Admins can sign in");
  await expectAccessible(ben.page, "room with a ticket, participant");
  await expectAccessible(ada.page, "room with a ticket, facilitator");
  await ada.page.getByRole("button", { name: "Edit the ticket" }).click();
  await expectAccessible(ada.page, "editing the ticket");
});
