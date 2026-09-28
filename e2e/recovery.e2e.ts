import { writeFile } from "node:fs/promises";
import { expectAccessible } from "./axe.js";
import {
  expect,
  newRoom,
  personOn,
  recordFrames,
  row,
  test,
} from "./fixtures.js";
import { OwnServer } from "./server.js";

const RESTARTING = "The server is restarting. Reconnecting…";

test("a server restart: everyone is told, reconnects on their own, and carries on", async ({
  people,
}) => {
  const server = await OwnServer.start();
  try {
    const roomId = await newRoom(server.url);
    const ada = await people.join(roomId, "Ada", {
      facilitate: true,
      baseURL: server.url,
    });
    const ben = await people.join(roomId, "Ben", { baseURL: server.url });
    await ben.card("5").click();
    await expect(row(ada.page, "Ben")).toContainText("Voted");

    // A deploy stops the server: every socket gets 1001, and each page
    // says the server is restarting instead of "Connection lost".
    expect(await server.stop()).toBe(0);
    for (const person of [ada, ben]) {
      await expect(
        person.page.getByRole("status").filter({ hasText: RESTARTING }),
      ).toBeVisible();
    }
    await expectAccessible(ben.page, "room, restarting");

    // The new server is up: both reconnect with no one touching anything.
    // Rooms lived in memory (ADR 0001), so the round starts over, empty.
    await server.restart();
    // In whichever order they reconnected: the delays are random (jitter).
    await expect(ada.heading).toHaveText(
      /^Waiting for (Ada and Ben|Ben and Ada)$/,
      { timeout: 20_000 },
    );
    await expect(ben.heading).toHaveText("0 of 2 have voted", {
      timeout: 20_000,
    });
    for (const person of [ada, ben]) {
      await expect(person.page.getByText(RESTARTING)).toHaveCount(0);
    }
    await expect(ben.card("5")).toHaveAttribute("aria-pressed", "false");

    // And the room works again.
    await ben.card("3").click();
    await ada.page.getByRole("button", { name: "Reveal votes" }).click();
    await expect(ben.page.locator(".result")).toHaveText("Only one vote: 3.");
  } finally {
    server.kill();
    const log = test.info().outputPath("server.log");
    await writeFile(log, server.output);
    await test.info().attach("server log", { path: log });
  }
});

test("a second tab takes over the seat, and the first can take it back", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const first = await people.join(roomId, "Ben");
  const ada = await people.join(roomId, "Ada", { facilitate: true });

  // Ben's focus is on a card when the room opens in his second tab.
  await first.card("5").focus();
  const secondPage = await first.page.context().newPage();
  const second = personOn(secondPage, "Ben", recordFrames(secondPage));
  await secondPage.goto(`/r/${roomId}`);
  await expect(second.heading).toHaveText("0 of 2 have voted");

  // The first tab stops, says why, and its heading takes focus: the card
  // that had it is gone.
  await expect(first.heading).toHaveText("This room is open in another tab.");
  await expect(first.heading).toBeFocused();
  await expect(first.page).toHaveTitle(
    "This room is open in another tab – Planning Poker Session",
  );
  await expectAccessible(first.page, "stopped: open in another tab");

  // Still one Ben in the room, not two.
  await expect(
    ada.page.getByRole("list", { name: "Participants" }).getByRole("listitem"),
  ).toHaveCount(2);

  // Use this tab: the first tab rejoins, and the second one stops.
  await first.page.getByRole("button", { name: "Use this tab" }).click();
  await expect(first.heading).toHaveText("0 of 2 have voted");
  await expect(second.heading).toHaveText("This room is open in another tab.");
});
