import type { Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import {
  expect,
  newRoom,
  recordSpeech,
  row,
  spoken,
  tabKey,
  test,
  type Bot,
  type Bots,
  type Person,
} from "./fixtures.js";

/**
 * A vote can change after the reveal; points settle at the reveal (ADR
 * 0011, docs/design.md, The revealed room): the cards on the scale are
 * toggle buttons, the result follows a change and is said once, the change
 * is marked "~~13~~ → 3", and pressing your own card sends nothing.
 */

/** A card on the scale, the button, by its number. */
function scaleCard(page: Page, card: string) {
  return page
    .getByRole("list", { name: "Votes on the deck" })
    .getByRole("button", { name: card, exact: true });
}

async function joinAll(bots: Bots, roomId: string, names: readonly string[]) {
  const joined: Bot[] = [];
  for (const name of names) joined.push(await bots.join(roomId, name));
  return joined;
}

/**
 * design.md's draw: 2, 3, 3, 5, 5, 13 is a draw between 3 and 5. Ben is
 * the one far off, on 13. Keep score is on, and nobody scores a draw.
 */
async function draw(
  people: {
    join: (roomId: string, name: string, o?: object) => Promise<Person>;
  },
  bots: Bots,
  baseURL: string,
) {
  const roomId = await newRoom(baseURL);
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  for (const page of [ada.page, ben.page]) {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  const crowd = await joinAll(bots, roomId, ["Cy", "Dee", "Eli", "Fay", "Gus"]);
  crowd[0]?.send({ type: "setScoring", on: true });
  const votes = ["2", "3", "3", "5", "5"] as const;
  crowd.forEach((bot, i) => bot.send({ type: "castVote", card: votes[i] }));
  await ben.card("13").click();
  for (const bot of crowd) {
    await expect(row(ada.page, bot.name).getByText("Voted")).toBeVisible();
  }
  await ada.page.getByRole("button", { name: "Reveal votes" }).click();
  for (const page of [ada.page, ben.page]) {
    await expect(page.locator(".result")).toHaveText(
      "Spread from 2 to 13. Draw between 3 and 5.",
    );
  }
  return { ada, ben, crowd };
}

test("a vote changed after the reveal breaks a draw: both see the new result and the mark, hear it once, and nobody scores", async ({
  people,
  bots,
  baseURL,
}) => {
  const { ada, ben } = await draw(people, bots, baseURL ?? "");
  for (const page of [ada.page, ben.page]) await recordSpeech(page);

  await scaleCard(ben.page, "3").click();
  for (const page of [ada.page, ben.page]) {
    await expect(page.locator(".result")).toHaveText(
      "Spread from 2 to 5. Result: 3.",
    );
    // The mark: the vote at the reveal struck through, then the new one.
    const benRow = row(page, "Ben");
    await expect(benRow.locator("s")).toHaveText("13");
    await expect(benRow.locator(".chip")).toHaveText("3");
    await expect(benRow).toContainText("3, changed from 13 after the reveal");
    // Settled at the reveal: a draw scored nobody, and the change doesn't.
    await expect(page.getByText("0 pts")).toHaveCount(7);
    await expect(
      page
        .getByRole("list", { name: "Votes on the deck" })
        .locator(".scale-step--win"),
    ).toHaveText(/^3/);
  }
  await expect
    .poll(() => spoken(ben.page))
    .toEqual(["Spread from 2 to 5. Result: 3."]);
  await expect
    .poll(() => spoken(ada.page))
    .toEqual(["Spread from 2 to 5. Result: 3."]);
  await expect(scaleCard(ben.page, "3")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(scaleCard(ben.page, "13")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Back to 13: the mark goes, and so does the result's change.
  await scaleCard(ben.page, "13").click();
  await expect(ada.page.locator(".result")).toHaveText(
    "Spread from 2 to 13. Draw between 3 and 5.",
  );
  await expect(row(ada.page, "Ben").locator("s")).toHaveCount(0);
});

test("pressing your own card after the reveal sends nothing and shows no error", async ({
  people,
  bots,
  baseURL,
}) => {
  const { ben } = await draw(people, bots, baseURL ?? "");
  const before = ben.frames.sent.length;
  const own = scaleCard(ben.page, "13");
  await own.click();
  await own.press("Enter");
  await own.press(" ");
  // Give a sent command time to come back as an error, then look.
  await ben.page.waitForTimeout(500);
  expect(
    ben.frames.sent.slice(before).filter((frame) => frame.type !== "ping"),
  ).toEqual([]);
  await expect(own).toHaveAttribute("aria-pressed", "true");
  await expect(ben.page.getByRole("alert")).toHaveCount(0);
});

test("the scale is one Tab stop; the arrow keys reach a card nobody chose, and Enter votes it", async ({
  people,
  bots,
  baseURL,
}) => {
  const { ada, ben } = await draw(people, bots, baseURL ?? "");
  const page = ben.page;
  // Tab through the whole page from the top: the scale's cards are one stop,
  // on Ben's own card.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  // One pass: until focus comes back where the first Tab put it, or stays
  // put at the end of the page.
  const stops: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press(tabKey(page));
    const stop = await page.evaluate(() => {
      const at = document.activeElement;
      if (at === null || at === document.body) return "body";
      return at.classList.contains("scale-card")
        ? `card ${at.textContent ?? ""}`
        : `${at.tagName} ${at.getAttribute("aria-label") ?? at.textContent ?? ""}`;
    });
    if (stops.length > 0 && (stop === stops[0] || stop === stops.at(-1))) {
      break;
    }
    stops.push(stop);
  }
  expect(stops.length, stops.join(" | ")).toBeLessThan(30);
  expect(
    stops.filter((stop) => stop.startsWith("card")),
    stops.join(" | "),
  ).toEqual(["card 13"]);

  // From 13, ArrowRight reaches 21, which nobody chose; Enter votes it.
  await scaleCard(page, "13").focus();
  await page.keyboard.press("ArrowRight");
  const empty = scaleCard(page, "21");
  await expect(empty).toBeFocused();
  await expect(
    page
      .locator(".scale-step--empty")
      .filter({ has: page.getByRole("button", { name: "21", exact: true }) }),
  ).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(empty).toHaveAttribute("aria-pressed", "true");
  await expect(row(ada.page, "Ben").locator(".chip")).toHaveText("21");
  await expect(row(ada.page, "Ben").locator("s")).toHaveText("13");
  // Focus stays on the card chosen, and Space works as Enter does.
  await expect(empty).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press(" ");
  await expect(scaleCard(page, "13")).toHaveAttribute("aria-pressed", "true");
});

test("axe: the revealed room with its card buttons, a vote changed, in both themes", async ({
  people,
  bots,
  baseURL,
}) => {
  const { ada, ben } = await draw(people, bots, baseURL ?? "");
  await scaleCard(ben.page, "3").click();
  await expect(row(ada.page, "Ben").locator("s")).toHaveText("13");
  await expectAccessible(ada.page, "revealed, a vote changed (facilitator)");
  await expectAccessible(ben.page, "revealed, a vote changed (participant)");
});

test("on a phone, the cards that got votes can be chosen; the others aren't on screen", async ({
  people,
  bots,
  baseURL,
}) => {
  const { ben } = await draw(people, bots, baseURL ?? "");
  await ben.page.setViewportSize({ width: 390, height: 844 });
  await expect(scaleCard(ben.page, "21")).toBeHidden();
  await scaleCard(ben.page, "3").click();
  await expect(ben.page.locator(".result")).toHaveText(
    "Spread from 2 to 5. Result: 3.",
  );
});
