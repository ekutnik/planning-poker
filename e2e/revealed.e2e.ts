import type { Locator, Page } from "@playwright/test";
import { expectAccessible } from "./axe.js";
import { expect, newRoom, row, test, type Bot, type Bots } from "./fixtures.js";

/**
 * The revealed room keeps its columns (v1.1, docs/design.md, The revealed
 * room): nothing moves at the reveal but what it adds, nothing sits below
 * the sentence, and a stack of more than five names ends in "+n more",
 * whose panel lists everyone on that card, over the cards.
 */

const NAMES = [
  ...["Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kai", "Lea"],
  ...["Max", "Ned", "Ola", "Pia", "Quin", "Rae", "Sam", "Tia", "Uma"],
];

/** Where the parts are, to the pixel: what must stay, and every card. */
function layout(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element | null) => {
      if (element === null) throw new Error("not in the page");
      // To a tenth of a pixel: browsers differ below that, as with
      // Firefox's 1199.99994 for a right edge at 1200.
      const tenth = (value: number) => Math.round(value * 10) / 10;
      const { x, y, right } = element.getBoundingClientRect();
      return { x: tenth(x), y: tenth(y), right: tenth(right) };
    };
    const cards = [
      ...document.querySelectorAll(".deck .card, .scale .scale-card"),
    ].map((card) => {
      const { x, y } = box(card);
      return { x, y };
    });
    // A step is as tall as its stack and its card, on its row's baseline,
    // so the card's top less the step's is the stack above it, gap included.
    const stacks = [...document.querySelectorAll(".scale-step")].map(
      (step) => box(step.querySelector(".scale-card")).y - box(step).y,
    );
    const action = box(document.querySelector(".controls button"));
    return {
      still: {
        status: box(document.querySelector("h1")),
        firstPerson: box(document.querySelector(".people > li")),
        // The ticket slot fills what the timer leaves: its start stays.
        ticket: (({ x, y }) => ({ x, y }))(
          box(document.querySelector(".ticket")),
        ),
        // Start next round is wider than Reveal votes: its end stays.
        action: { right: action.right, y: action.y },
      },
      cards,
      stacks,
    };
  });
}

function vote(bots: readonly Bot[], card: string) {
  for (const bot of bots) bot.send({ type: "castVote", card });
}

/** One at a time, so they join in this order: stacks follow join order. */
async function joinAll(bots: Bots, roomId: string, names: readonly string[]) {
  const joined: Bot[] = [];
  for (const name of names) joined.push(await bots.join(roomId, name));
  return joined;
}

/** Waits until the page shows each of them as voted. */
async function seenVoting(page: Page, bots: readonly Bot[]) {
  for (const bot of bots) {
    await expect(row(page, bot.name).getByText("Voted")).toBeVisible();
  }
}

for (const { width, touch } of [
  { width: 1280, touch: false },
  { width: 880, touch: false },
  { width: 1180, touch: true },
]) {
  test(`at the reveal nothing moves but what it adds: the cards go down by the names above them, ${String(width)} px${touch ? ", with touch" : ""}`, async ({
    people,
    bots,
    baseURL,
  }) => {
    const roomId = await newRoom(baseURL ?? "");
    const ada = await people.join(roomId, "Ada", {
      facilitate: true,
      tools: { ticket: true, timer: true },
      touch,
    });
    const ben = await people.join(roomId, "Ben", { touch });
    for (const page of [ada.page, ben.page]) {
      await page.setViewportSize({ width, height: 900 });
    }
    // Three on 5, one on 13 and one on ?: at 880 px, a stack in each of
    // the deck's two rows.
    await ben.card("5").click();
    const crowd = await joinAll(bots, roomId, NAMES.slice(0, 4));
    vote(crowd.slice(0, 2), "5");
    vote(crowd.slice(2, 3), "13");
    vote(crowd.slice(3, 4), "?");
    await seenVoting(ada.page, crowd);
    await seenVoting(ben.page, crowd);
    // Off the deck, so no card is lifted by a hover.
    await ben.page.mouse.move(0, 0);
    await expect
      .poll(() =>
        ben.page
          .locator(".card")
          .evaluateAll((cards) =>
            cards.every((card) => getComputedStyle(card).transform === "none"),
          ),
      )
      .toBe(true);
    const before = [await layout(ada.page), await layout(ben.page)];

    await ada.page.getByRole("button", { name: "Reveal votes" }).click();
    for (const [i, page] of [ada.page, ben.page].entries()) {
      await expect(
        page.getByRole("button", { name: "Start next round" }),
      ).toBeVisible();
      // The names settle once, at the reveal (docs/design.md, Motion).
      await page.waitForTimeout(400);
      const voting = before[i];
      const revealed = await layout(page);
      if (voting === undefined) throw new Error("no layout");
      expect(
        revealed.still,
        "the status line, the people, the action row",
      ).toEqual(voting.still);

      // Each row of cards goes down by the tallest stack in it, and every
      // row above it; across, every card stays exactly where it was.
      const rows = [...new Set(voting.cards.map((card) => card.y))].sort(
        (a, b) => a - b,
      );
      let shift = 0;
      const expected = rows.map((y) => {
        const inRow = voting.cards.flatMap((card, index) =>
          card.y === y ? [revealed.stacks[index] ?? 0] : [],
        );
        shift += Math.max(...inRow);
        return shift;
      });
      expect(
        Math.max(...revealed.stacks),
        "names above a card",
      ).toBeGreaterThan(0);
      for (const [index, card] of voting.cards.entries()) {
        const now = revealed.cards[index];
        const down = expected[rows.indexOf(card.y)] ?? Number.NaN;
        expect(now?.x, `card ${String(index)} across`).toBe(card.x);
        expect(
          Math.abs((now?.y ?? Number.NaN) - card.y - down),
          `card ${String(index)} goes down by the stacks above it, and no more`,
        ).toBeLessThanOrEqual(0.5);
      }

      // Nothing on the right below the sentence and the line under it
      // (ADR 0011): the people are on the left.
      const below = await page.evaluate(() => {
        const result = document.querySelector(".result-area");
        if (result === null) return ["no sentence"];
        const bottom = result.getBoundingClientRect().bottom;
        return [...document.querySelectorAll(".round *")]
          .filter(
            (element) =>
              element.closest(".round-side") === null &&
              element.getBoundingClientRect().height > 0 &&
              element.getBoundingClientRect().top >= bottom - 0.5,
          )
          .map((element) => element.className || element.tagName);
      });
      expect(below, "below the sentence").toEqual([]);
    }
  });
}

/** One card's step on the scale. */
function step(page: Page, card: string): Locator {
  return page.locator(".scale-step").filter({
    has: page.locator(".scale-card", { hasText: new RegExp(`^${card}$`) }),
  });
}

/** The stack's names you can see: past the cap they're 1px, off screen. */
function seenNames(stack: Locator): Promise<string[]> {
  return stack
    .locator(".scale-name")
    .evaluateAll((names) =>
      names
        .filter((name) => name.getBoundingClientRect().width > 1)
        .map((name) => name.textContent ?? ""),
    );
}

const cardBoxes = (page: Page) =>
  page
    .locator(".scale-card")
    .evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().toJSON() as DOMRect),
    );

test("a stack of 12 shows five names and +7 more; its panel lists all 12 over the cards, and closes as the Menu does", async ({
  people,
  bots,
  baseURL,
}) => {
  test.setTimeout(60_000);
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const page = ada.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  const crowd = await joinAll(bots, roomId, NAMES.slice(0, 18));
  const onFive = crowd.slice(0, 12);
  const onEight = crowd.slice(12);
  const vote5and8 = async () => {
    vote(onFive, "5");
    vote(onEight, "8");
    await seenVoting(page, [...onFive, ...onEight]);
    await page.getByRole("button", { name: "Reveal votes" }).click();
  };
  await vote5and8();

  // The cap: five names you can see, the first five to join nearest the
  // card, then "+7 more"; all 12 in the list a screen reader hears.
  const more = page.getByRole("button", {
    name: "+7 more: show all 12 who chose 5",
    exact: true,
  });
  await expect(more).toHaveText("+7 more"); // the scale is on screen
  const five = step(page, "5");
  const fiveNames = NAMES.slice(0, 12);
  expect(await seenNames(five)).toEqual(fiveNames.slice(0, 5));
  await expect(five.locator(".scale-names").getByRole("listitem")).toHaveText(
    fiveNames,
  );

  await expect(more).toHaveAttribute("aria-expanded", "false");
  const eight = page.getByRole("button", {
    name: "+1 more: show all 6 who chose 8",
    exact: true,
  });
  await expect(eight).toHaveText("+1 more");

  // Open: everyone on the card, in join order, over the cards: nothing moves.
  const cards = await cardBoxes(page);
  await more.click();
  const panel = five.locator(".scale-more-panel");
  await expect(panel).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("12 chose 5")).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveText(fiveNames);
  expect(await cardBoxes(page), "the cards, with the panel open").toEqual(
    cards,
  );
  await expectAccessible(page, "revealed, the +7 more panel open");

  // Escape closes it, and focus goes back to its button.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused();

  // A click outside closes it, and so does a second click on its button.
  await more.click();
  await expect(panel).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(panel).toBeHidden();
  await more.click();
  await expect(panel).toBeVisible();
  await more.click();
  await expect(panel).toBeHidden();

  // One at a time: opening 8's closes 5's.
  await more.click();
  await eight.click();
  await expect(step(page, "8").locator(".scale-more-panel")).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Escape");

  // The room changes shape under it: someone it lists leaves, so it closes
  // rather than show a list that is no longer true.
  await more.click();
  await expect(panel).toBeVisible();
  onFive[11]?.send({ type: "leave" });
  const eleven = page.getByRole("button", {
    name: "+6 more: show all 11 who chose 5",
    exact: true,
  });
  await expect(eleven).toHaveText("+6 more");
  await expect(five.locator(".scale-more-panel")).toBeHidden();

  // Start next round, from someone else, closes it with the scale; the next
  // reveal starts with every panel closed.
  await eleven.click();
  await expect(five.locator(".scale-more-panel")).toBeVisible();
  onFive[0]?.send({ type: "reset" });
  await expect(
    page.getByRole("button", { name: "Reveal votes" }),
  ).toBeVisible();
  await expect(page.locator(".scale-more-panel")).toHaveCount(0);
  onFive.pop();
  await vote5and8();
  await expect(
    page.getByRole("button", {
      name: "+6 more: show all 11 who chose 5",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".scale-more-panel:visible")).toHaveCount(0);
});

test("a name too long for its column is cut with an ellipsis on one line, and stays whole for a screen reader", async ({
  people,
  bots,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const page = ada.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  const crowd = await joinAll(bots, roomId, [
    "Alexandra Oppenheimer",
    "Bartholomew",
    "Cy",
  ]);
  vote(crowd, "5");
  await seenVoting(page, crowd);
  crowd[0]?.send({ type: "reveal" });
  const stack = step(page, "5");
  await expect(stack.locator(".scale-name")).toHaveText([
    "Alexandra Oppenheimer",
    "Bartholomew",
    "Cy",
  ]);
  // Every row of the stack is one 24 px line; the long ones are cut short.
  const rows = () =>
    stack.locator(".scale-name").evaluateAll((names) =>
      names.map((name) => ({
        height: name.getBoundingClientRect().height,
        cut: name.scrollWidth > name.clientWidth,
      })),
    );
  await expect.poll(rows).toEqual([
    { height: 24, cut: true },
    { height: 24, cut: true },
    { height: 24, cut: false },
  ]);
  // In full in the list a screen reader hears, and in the people list.
  await expect(stack.locator(".scale-names").getByRole("listitem")).toHaveText([
    "Alexandra Oppenheimer",
    "Bartholomew",
    "Cy",
  ]);
  await expect(row(page, "Alexandra Oppenheimer")).toBeVisible();
});

test("when a focused +n more goes, as its card drops to five, focus moves to the scale, not the page", async ({
  people,
  bots,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const page = ada.page;
  await page.setViewportSize({ width: 1280, height: 900 });
  const crowd = await joinAll(bots, roomId, NAMES.slice(0, 6));
  vote(crowd, "8");
  await seenVoting(page, crowd);
  crowd[0]?.send({ type: "reveal" });
  const more = page.getByRole("button", {
    name: "+1 more: show all 6 who chose 8",
    exact: true,
  });
  await more.focus();
  await expect(more).toBeFocused();

  crowd[5]?.send({ type: "leave" });
  await expect(more).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Votes on the deck" }),
  ).toBeFocused();
});
