import { expect, newRoom, row, test } from "./fixtures.js";

test("votes stay private until the reveal, on the wire and on the screen", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  const cy = await people.join(roomId, "Cy");

  // Ben votes 13, Ada (facilitator view, a shared screen) votes 21.
  await ben.card("13").click();
  await ada.card("21").click();
  await expect(row(cy.page, "Ben")).toContainText("Voted");
  await expect(row(cy.page, "Ada")).toContainText("Voted");

  // Nothing Cy's browser received names either card: the server sends
  // that someone voted, never what.
  const cyHeard = JSON.stringify(cy.frames.received);
  expect(cyHeard).not.toContain('"13"');
  expect(cyHeard).not.toContain('"21"');
  // Ben's browser hears only his own vote back.
  expect(JSON.stringify(ben.frames.received)).not.toContain('"21"');

  // Ada's screen is shared, so her own card shows nowhere: no card chosen
  // in the deck, and "21" appears only on the deck's own card. First wait
  // for her own screen to have her vote (the snapshot that says she voted
  // carries it), or "nothing chosen" would pass before it arrived.
  await expect(ada.page.getByText("You've voted")).toBeVisible();
  await expect(
    ada.page
      .getByRole("toolbar", { name: "Your card" })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(0);
  const outsideTheDeck = await ada.page.evaluate(() => {
    const main = document.querySelector("main")?.cloneNode(true) as
      HTMLElement | undefined;
    main?.querySelector('[role="toolbar"]')?.remove();
    return main?.innerText ?? "";
  });
  expect(outsideTheDeck).not.toContain("21");
  expect(await ada.page.title()).not.toContain("21");

  // The room id is the room's credential: never on screen, never in the
  // title, and the page is served with no-referrer, so a link out of it
  // can't send the address anywhere.
  for (const person of [ada, ben, cy]) {
    expect(await person.page.locator("body").innerText()).not.toContain(roomId);
    expect(await person.page.title()).not.toContain(roomId);
  }
  const response = await cy.page.reload();
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");

  // At the reveal, everyone sees every card.
  await ada.page.getByRole("button", { name: "Reveal votes" }).click();
  for (const person of [ada, ben, cy]) {
    await expect(row(person.page, "Ben")).toContainText("13");
    await expect(row(person.page, "Ada")).toContainText("21");
  }
});
