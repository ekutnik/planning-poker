import type { Locator, Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import {
  expect,
  newRoom,
  test,
  type People,
  type PersonOptions,
} from "./fixtures.js";

/**
 * The room's fixed slots (docs/design.md, The room's layout): in wide, the
 * deck, the round's action and the people never move when a tool is
 * switched on or used; every control is one of three heights; and the
 * status line lines up with the action row.
 */

const WIDE = { width: 1280, height: 800 };

/** Where the parts that must stay still are, to the pixel. */
async function positions(page: Page) {
  const at = async (locator: Locator) => {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not on screen");
    return { x: box.x, y: box.y, width: box.width };
  };
  return {
    deck: await at(page.locator(".deck")),
    action: await at(page.locator(".controls button")),
    people: await at(page.getByRole("list", { name: "Participants" })),
  };
}

/** Switches one of the Menu's switches, and closes the Menu again. */
async function toggle(page: Page, name: string) {
  await page.getByRole("button", { name: "Menu" }).click();
  const control = page.getByRole("switch", { name });
  const before = await control.getAttribute("aria-checked");
  await control.click();
  await expect(control).not.toHaveAttribute("aria-checked", before ?? "");
  await page.keyboard.press("Escape");
  await expect(page.locator(".menu-panel")).toBeHidden();
}

async function join(
  people: People,
  roomId: string,
  name: string,
  options: Omit<PersonOptions, "name"> = {},
) {
  const person = await people.join(roomId, name, options);
  await person.page.setViewportSize(WIDE);
  return person;
}

test("nothing moves in the facilitator view as each tool comes and is used", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await join(people, roomId, "Ada", { facilitate: true });
  await join(people, roomId, "Ben");
  const page = ada.page;
  const still = await positions(page);
  const check = async (step: string) => {
    expect(await positions(page), step).toEqual(still);
  };

  await toggle(page, "Ticket");
  await expect(
    page.getByRole("button", { name: "Add a ticket" }),
  ).toBeVisible();
  await check("Ticket on");
  await toggle(page, "Timer");
  await expect(
    page.getByRole("button", { name: "Start the timer" }),
  ).toBeVisible();
  await check("Timer on");
  await toggle(page, "Keep score");
  await expect(page.getByText("0 pts").first()).toBeVisible();
  await check("Keep score on");
  await page.getByRole("button", { name: "Start the timer" }).click();
  await expect(
    page.getByRole("button", { name: "Pause the timer" }),
  ).toBeVisible();
  await check("timer running");
  await page.getByRole("button", { name: "Add a ticket" }).click();
  await expect(page.getByLabel("Now estimating")).toBeFocused();
  await check("adding a ticket");
  await page
    .getByLabel("Now estimating")
    .fill("PROJ-482 Admins can sign in with SSO from the company directory");
  await page.getByLabel("Now estimating").press("Enter");
  await expect(page.locator(".ticket-text")).toBeVisible();
  await check("a ticket");
  await page.getByRole("button", { name: "Edit the ticket" }).click();
  await expect(page.getByLabel("Now estimating")).toBeFocused();
  await check("editing the ticket");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause the timer" }).click();
  await expect(
    page.getByRole("button", { name: "Resume the timer" }),
  ).toBeVisible();
  await check("timer paused");
});

test("nothing moves for a participant as a ticket and a timer arrive", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await join(people, roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true, timer: true },
  });
  const ben = await join(people, roomId, "Ben");
  const still = await positions(ben.page);

  await ada.page.getByRole("button", { name: "Add a ticket" }).click();
  await ada.page.getByLabel("Now estimating").fill("PROJ-482");
  await ada.page.getByLabel("Now estimating").press("Enter");
  await expect(ben.page.locator(".ticket-text")).toHaveText("PROJ-482");
  expect(await positions(ben.page), "a ticket").toEqual(still);

  await ada.page.getByRole("button", { name: "Start the timer" }).click();
  await expect(ben.page.locator(".timer--readout")).toBeVisible();
  expect(await positions(ben.page), "a running timer").toEqual(still);
});

test("lines the status line up with the action row", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await join(people, roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true, timer: true },
  });
  const ben = await join(people, roomId, "Ben");
  const centre = async (locator: Locator) => {
    const box = await locator.boundingBox();
    return (box?.y ?? Number.NaN) + (box?.height ?? Number.NaN) / 2;
  };
  for (const page of [ada.page, ben.page]) {
    const status = page.getByRole("heading", { level: 1 });
    const row = await centre(page.locator(".ticket"));
    expect(Math.abs((await centre(status)) - row)).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await centre(page.locator(".controls button"))) - row),
    ).toBeLessThanOrEqual(1);
    expect((await page.locator(".ticket").boundingBox())?.height).toBe(56);
  }
});

/**
 * Three heights and no others: 44 for the round's one action and the
 * header's buttons, 40 for your own vote's buttons, the timer block and the
 * ticket field, 28 for the small tools. Deck cards are the deck, not
 * controls of a height.
 */
const HEIGHTS: readonly [string, number][] = [
  ["Reveal votes", 44],
  ["Start next round", 44],
  ["Copy link", 44],
  ["Menu", 44],
  ["Clear my vote", 40],
  ["Show my vote", 40],
  ["Hide my vote", 40],
  ["Nudge", 28],
  ["Edit the ticket", 28],
  ["Add a ticket", 28],
  ["Save", 28],
  ["Cancel", 28],
  ["Start the timer", 28],
  ["Pause the timer", 28],
  ["Resume the timer", 28],
  ["Add 30 seconds", 28],
];

/** Every control on screen, outside the deck and the Menu's panel. */
async function controlHeights(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "button, input, select, .timer-block",
      ),
    ]
      .filter(
        (element) =>
          !element.closest(".deck, .menu-panel") &&
          element.getBoundingClientRect().height > 0,
      )
      .map((element) => ({
        name:
          element.className === "timer-block"
            ? "the timer block"
            : (element.getAttribute("aria-label") ??
              (element as HTMLInputElement).labels?.[0]?.textContent ??
              (element.textContent ?? "").trim()),
        height: element.getBoundingClientRect().height,
      })),
  );
}

test("every control in the room is 44, 40 or 28 px tall, as its kind says", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await join(people, roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true, timer: true },
  });
  await join(people, roomId, "Ben");
  const page = ada.page;
  const seen = new Map<string, number>();
  const measure = async () => {
    for (const { name, height } of await controlHeights(page)) {
      expect([28, 40, 44], `${name}: ${String(height)} px`).toContain(height);
      seen.set(name, height);
    }
  };

  await measure(); // Add a ticket, the idle timer, Nudge, Reveal votes
  await page.getByRole("button", { name: "Add a ticket" }).click();
  await expect(page.getByLabel("Now estimating")).toBeFocused();
  await measure(); // the field, Save and Cancel
  await page.getByLabel("Now estimating").fill("PROJ-482");
  await page.getByLabel("Now estimating").press("Enter");
  await ada.card("5").click();
  await expect(
    page.getByRole("button", { name: "Show my vote" }),
  ).toBeVisible();
  await measure(); // your own vote's buttons
  await page.getByRole("button", { name: "Show my vote" }).click();
  await page.getByRole("button", { name: "Start the timer" }).click();
  await expect(
    page.getByRole("button", { name: "Hide my vote" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause the timer" }),
  ).toBeVisible();
  await measure(); // Edit, Pause, +30 s, Hide my vote
  await page.getByRole("button", { name: "Pause the timer" }).click();
  await expect(
    page.getByRole("button", { name: "Resume the timer" }),
  ).toBeVisible();
  await measure(); // Resume
  await page.getByRole("button", { name: "Reveal votes" }).click();
  await expect(
    page.getByRole("button", { name: "Start next round" }),
  ).toBeVisible();
  await measure(); // the revealed round

  for (const [name, height] of HEIGHTS) {
    const found = [...seen].find(([seenName]) => seenName.startsWith(name));
    expect(found, `${name} was measured`).toBeDefined();
    expect(found?.[1], name).toBe(height);
  }
  expect(seen.get("Now estimating"), "the ticket field").toBe(40);
  expect(seen.get("the timer block")).toBe(40);
});

test("Timer can be switched off only while the timer is idle", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await join(people, roomId, "Ada", {
    facilitate: true,
    tools: { timer: true },
  });
  const page = ada.page;
  const menu = page.getByRole("button", { name: "Menu" });
  const timer = page.getByRole("switch", { name: "Timer" });
  const busy = page.getByText("Available once the timer has stopped.");

  await menu.click();
  await expect(timer).toBeEnabled();
  await expect(busy).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Start the timer" }).click();
  await menu.click();
  await expect(timer).toBeDisabled();
  await expect(busy).toBeVisible();
  await expect(timer).toHaveAccessibleDescription(
    "Available once the timer has stopped.",
  );
  await expectAccessible(page, "Menu, Timer held on");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Pause the timer" }).click();
  await menu.click();
  await expect(timer).toBeDisabled();
  await page.keyboard.press("Escape");

  // A reveal stops it: the switch is free again.
  await ada.card("5").click();
  await page.getByRole("button", { name: "Reveal votes" }).click();
  await expect(
    page.getByRole("button", { name: "Start next round" }),
  ).toBeVisible();
  await menu.click();
  await expect(timer).toBeEnabled();
  await timer.click();
  await expect(timer).toHaveAttribute("aria-checked", "false");
});

test("Ticket and Timer are this browser's, kept under planning-poker:tools:v1", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await join(people, roomId, "Ada", { facilitate: true });
  const page = ada.page;
  const stored = () =>
    page.evaluate(() => localStorage.getItem("planning-poker:tools:v1"));

  // Never set: both off, and nothing stored.
  await page.getByRole("button", { name: "Menu" }).click();
  for (const name of ["Ticket", "Timer"]) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  }
  await expectAccessible(page, "Menu with the Session tools");
  expect(await stored()).toBeNull();
  await page.keyboard.press("Escape");

  await toggle(page, "Timer");
  expect(JSON.parse((await stored()) ?? "null")).toEqual({
    ticket: false,
    timer: true,
  });
  // Kept for the next visit.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start the timer" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a ticket" })).toHaveCount(
    0,
  );
});

test("the phone room: tools in a block at the top, only while there is something in it", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", {
    facilitate: true,
    tools: { ticket: true, timer: true },
  });
  const ben = await people.join(roomId, "Ben");
  for (const person of [ada, ben]) {
    await person.page.setViewportSize({ width: 390, height: 844 });
  }
  const tools = (page: Page) => page.locator(".round-tools");
  await expect(tools(ben.page)).toBeHidden();
  await expect(tools(ada.page)).toBeVisible();
  await expectAccessible(ada.page, "phone, facilitator with the tools");

  await ada.page.getByRole("button", { name: "Add a ticket" }).click();
  await ada.page.getByLabel("Now estimating").fill("PROJ-482");
  await ada.page.getByLabel("Now estimating").press("Enter");
  await ada.page.getByRole("button", { name: "Start the timer" }).click();
  await expect(ben.page.locator(".timer--readout")).toBeVisible();
  await expect(tools(ben.page)).toBeVisible();
  // First, above the status line.
  const block = await tools(ben.page).boundingBox();
  const status = await ben.heading.boundingBox();
  expect((block?.y ?? 0) + (block?.height ?? 0)).toBeLessThan(status?.y ?? 0);
  await expectAccessible(
    ben.page,
    "phone, participant with a ticket and a timer",
  );
});
