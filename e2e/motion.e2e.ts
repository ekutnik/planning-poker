import { expect, newRoom, test } from "./fixtures.js";

const LIFTED = "matrix(1, 0, 0, 1, 0, -2)";

test("a hovered card lifts 2px, and pressing it settles it back down", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ben = await people.join(roomId, "Ben");
  const card = ben.card("8");
  const transform = () =>
    card.evaluate((element) => getComputedStyle(element).transform);

  await card.hover();
  await expect.poll(transform).toBe(LIFTED);
  await ben.page.mouse.down();
  await expect.poll(transform).toBe("none");
  await ben.page.mouse.up();
  await expect(card).toHaveAttribute("aria-pressed", "true");
});

test("with reduced motion, a hovered card doesn't move", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ben = await people.join(roomId, "Ben");
  await ben.page.emulateMedia({ reducedMotion: "reduce" });
  const card = ben.card("8");
  await card.hover();
  // Long enough for the 120ms lift, had it started.
  await ben.page.waitForTimeout(300);
  expect(
    await card.evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");
});
