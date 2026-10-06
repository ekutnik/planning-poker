import { isolate } from "../src/web/isolate.js";
import { expectAccessible } from "./axe.js";
import { expect, newRoom, row, test } from "./fixtures.js";

// Ali and Sara, in Arabic, written as escapes: the browser shapes them.
const ALI = "\u0639\u0644\u064A";
const SARA = "\u0633\u0627\u0631\u0629";

test("right-to-left names keep the status line in its order, and the room accessible (#80)", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  await people.join(roomId, ALI);
  await people.join(roomId, SARA);
  await people.join(roomId, "Ben");
  await ada.card("3").click();
  await expect(row(ada.page, "Ada")).toContainText("Voted");
  await expect(ada.heading).toHaveText(
    `Waiting for ${isolate(ALI)}, ${isolate(SARA)} and ${isolate("Ben")}`,
  );

  // Where each part is drawn, not where it sits in the string. Without the
  // isolates, the comma between two Arabic names is part of a right-to-left
  // run, so Sara would be drawn left of Ali: the list's order reversed.
  const parts = ["Waiting for", ALI, SARA, "and", "Ben"];
  const drawn = await ada.heading.evaluate((heading, parts) => {
    const text = heading.firstChild;
    if (!(text instanceof Text)) throw new Error("expected one text node");
    let from = 0;
    return parts.map((part) => {
      const start = text.data.indexOf(part, from);
      from = start + part.length;
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, from);
      const box = range.getBoundingClientRect();
      return { top: Math.round(box.top), left: box.left };
    });
  }, parts);
  // One line, so left to right is the order read.
  expect(new Set(drawn.map(({ top }) => top)).size).toBe(1);
  const lefts = drawn.map(({ left }) => left);
  expect(lefts).toEqual([...lefts].sort((a, b) => a - b));

  // The names in their own elements: dir="auto" on each.
  await expect(row(ada.page, ALI).locator(".person-name")).toHaveAttribute(
    "dir",
    "auto",
  );
  await expectAccessible(ada.page, "room, right-to-left names");
});
