import {
  expect,
  personOn,
  recordFrames,
  recordSpeech,
  row,
  spoken,
  test,
} from "./fixtures.js";

const TITLE = (part: string) => `${part} – Planning Poker Session`;

test("a full round in two browsers: create, join, vote, reveal, next round", async ({
  page,
  people,
}) => {
  // Ada creates the room from the landing page. "I'm running this
  // session" starts off, as for anyone who never chose; she turns it on,
  // so she gets the facilitator view.
  const adaFrames = recordFrames(page);
  await page.goto("/");
  await page.getByLabel("Your name").fill("Ada");
  const running = page.getByRole("switch", {
    name: "I'm running this session",
  });
  await expect(running).toHaveAttribute("aria-checked", "false");
  await running.click();
  await expect(running).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page).toHaveURL(/\/r\/[\w-]{11}$/);
  const ada = personOn(page, "Ada", adaFrames);
  await expect(ada.heading).toHaveText("Waiting for Ada");
  await expect(ada.heading).toBeFocused(); // the form went with the landing
  await expect(page.getByText("Facilitating", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle(TITLE("1 waiting"));
  const roomId = new URL(page.url()).pathname.slice("/r/".length);

  // Ben opens the link in his own browser. He has no name yet, so he is
  // asked for one, and the switch starts off: he gets the participant view.
  const ben = await people.open(`/r/${roomId}`);
  await expect(ben.heading).toHaveText("Join the room");
  await expect(
    ben.page.getByRole("switch", { name: "I'm running this session" }),
  ).toHaveAttribute("aria-checked", "false");
  await ben.page.getByLabel("Your name").fill("Ben");
  await ben.page.getByRole("button", { name: "Join" }).click();
  await expect(ben.heading).toHaveText("0 of 2 have voted");
  await expect(ben.heading).toBeFocused();
  await expect(
    ben.page.getByText("Facilitating", { exact: true }),
  ).not.toBeVisible();
  await expect(ada.heading).toHaveText("Waiting for Ada and Ben");
  await expect(page).toHaveTitle(TITLE("2 waiting"));
  await recordSpeech(ada.page);
  await recordSpeech(ben.page);

  // Ben votes 5: his card shows as chosen. Ada sees that he voted, never
  // what he chose.
  await ben.card("5").click();
  await expect(ben.card("5")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "Ben")).toContainText("Voted");
  await expect(ada.heading).toHaveText("Waiting for Ada");
  await expect(page).toHaveTitle(TITLE("1 waiting"));

  // Ada votes 8. In the facilitator view her own card is never shown:
  // no card is chosen, and a pill says only that she voted.
  await ada.card("8").click();
  await expect(page.getByText("You've voted")).toBeVisible();
  await expect(
    page
      .getByRole("toolbar", { name: "Your card" })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(0);
  await expect(ada.heading).toHaveText("Everyone has voted");
  await expect(ben.heading).toHaveText("Everyone has voted");
  await expect(page).toHaveTitle(TITLE("Everyone voted"));

  // Ben's focus is on the header's Copy link, which stays at the reveal.
  await ben.page.getByRole("button", { name: "Copy link" }).focus();

  // Ada reveals. The button she pressed goes, so her focus moves to the
  // new heading, which she hears: the live region then gives only the
  // result. Ben's focus stayed put, so he hears it whole. Once each.
  await page.getByRole("button", { name: "Reveal votes" }).click();
  for (const person of [ada, ben]) {
    await expect(person.heading).toHaveText("Votes revealed");
    await expect(person.page.locator(".result")).toHaveText(
      "Spread from 5 to 8. No result: no card has two votes.",
    );
    await expect(row(person.page, "Ada")).toContainText("8");
    await expect(row(person.page, "Ben")).toContainText("5");
    await expect(person.page).toHaveTitle(TITLE("Votes revealed"));
  }
  await expect(ada.heading).toBeFocused();
  await expect(
    ben.page.getByRole("button", { name: "Copy link" }),
  ).toBeFocused();
  await expect
    .poll(() => spoken(ada.page))
    .toEqual(["Spread from 5 to 8. No result: no card has two votes."]);
  await expect
    .poll(() => spoken(ben.page))
    .toEqual([
      "Votes revealed. Spread from 5 to 8. No result: no card has two votes.",
    ]);

  // Ada starts the next round: the deck is back for both, with no votes,
  // her focus on the new heading, and "Next round started." said once each.
  await page.getByRole("button", { name: "Start next round" }).click();
  await expect(ada.heading).toHaveText("Waiting for Ada and Ben");
  await expect(ada.heading).toBeFocused();
  await expect(ben.heading).toHaveText("0 of 2 have voted");
  await expect(ben.card("5")).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveTitle(TITLE("2 waiting"));
  await expect
    .poll(() => spoken(ada.page))
    .toEqual([
      "Spread from 5 to 8. No result: no card has two votes.",
      "Next round started.",
    ]);
  await expect
    .poll(() => spoken(ben.page))
    .toEqual([
      "Votes revealed. Spread from 5 to 8. No result: no card has two votes.",
      "Next round started.",
    ]);

  // Each browser sent only its own actions: one join, one vote, and the
  // reveal and the reset from Ada.
  const types = (frames: typeof adaFrames) =>
    frames.sent.map((frame) => frame.type).filter((type) => type !== "ping");
  expect(types(ada.frames)).toEqual(["join", "castVote", "reveal", "reset"]);
  expect(types(ben.frames)).toEqual(["join", "castVote"]);
});
