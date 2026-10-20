import type { Page } from "@playwright/test";
import { expect, newRoom, test } from "./fixtures.js";

/*
 * A nudge's sound (v1.1): the person nudged hears a short chime, once the
 * page has had a gesture, unless this browser's Sound switch is off. The
 * audio is stubbed: each page gets an AudioContext that counts what the
 * chime asks of it, installed before the page's own scripts run.
 */

declare global {
  interface Window {
    __e2eAudio?: { created: number; notes: number };
  }
}

const BANNER = "The room is waiting for your vote.";

async function stubAudio(page: Page) {
  await page.addInitScript(() => {
    const audio = { created: 0, notes: 0 };
    window.__e2eAudio = audio;
    class FakeAudioContext {
      state = "running";
      currentTime = 0;
      destination = {};
      constructor() {
        audio.created += 1;
      }
      resume() {
        return Promise.resolve();
      }
      createGain() {
        const param = {
          setValueAtTime: () => undefined,
          linearRampToValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
        };
        return { gain: param, connect: () => undefined };
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: { value: 0 },
          connect: () => undefined,
          start: () => {
            audio.notes += 1;
          },
          stop: () => undefined,
        };
      }
    }
    Object.defineProperty(window, "AudioContext", { value: FakeAudioContext });
  });
}

const audio = (page: Page) =>
  page.evaluate(() => window.__e2eAudio ?? { created: 0, notes: 0 });

test("a nudge plays the chime in a tab that has had a gesture, and not before", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben", { beforeOpen: stubAudio });
  const cy = await people.join(roomId, "Cy", { beforeOpen: stubAudio });
  const cyErrors: string[] = [];
  cy.page.on("console", (message) => {
    if (message.type() === "error") cyErrors.push(message.text());
  });

  // Ben clicks the page once, as anyone does: that unlocks the sound.
  await ben.heading.click();
  await ada.page.getByRole("button", { name: "Nudge Ben" }).click();
  await expect(ben.page.getByText(BANNER)).toBeVisible();
  await expect.poll(() => audio(ben.page)).toEqual({ created: 1, notes: 2 });

  // Cy's tab was opened and never touched: the browser allows no sound, so
  // none is made, nothing is logged, and the banner says it all the same.
  await ada.page.getByRole("button", { name: "Nudge Cy" }).click();
  await expect(cy.page.getByText(BANNER)).toBeVisible();
  expect(await audio(cy.page)).toEqual({ created: 0, notes: 0 });
  expect(cyErrors).toEqual([]);
});

test("joining with the Join button turns the sound on: that click is the gesture", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  // A link with no name stored asks for one. The name is filled in without a
  // key press, so the click on Join is the page's only gesture.
  const ben = await people.open(`/r/${roomId}`, {
    name: null,
    beforeOpen: stubAudio,
  });
  await ben.page.getByLabel("Your name").fill("Ben");
  expect(await audio(ben.page)).toEqual({ created: 0, notes: 0 });
  await ben.page.getByRole("button", { name: "Join" }).click();
  const nudgeBen = ada.page.getByRole("button", { name: "Nudge Ben" });
  await expect(nudgeBen).toBeVisible(); // Ben has joined
  expect(await audio(ben.page)).toEqual({ created: 1, notes: 0 });

  await nudgeBen.click();
  await expect(ben.page.getByText(BANNER)).toBeVisible();
  await expect.poll(() => audio(ben.page)).toEqual({ created: 1, notes: 2 });
});

test("the Sound switch is this browser's: off, a nudge is silent, and it stays off", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben", { beforeOpen: stubAudio });

  // On until turned off; turning it off is a gesture, so the audio is ready.
  await ben.page.getByRole("button", { name: "Menu" }).click();
  const sound = ben.page.getByRole("switch", { name: "Sound" });
  await expect(sound).toHaveAttribute("aria-checked", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-checked", "false");
  expect(
    await ben.page.evaluate(() =>
      window.localStorage.getItem("planning-poker:sound"),
    ),
  ).toBe("off");
  await ben.page.keyboard.press("Escape");

  await ada.page.getByRole("button", { name: "Nudge Ben" }).click();
  await expect(ben.page.getByText(BANNER)).toBeVisible();
  expect(await audio(ben.page)).toEqual({ created: 1, notes: 0 });

  // Remembered across a reload.
  await ben.page.reload();
  await expect(ben.heading).toBeVisible();
  await ben.page.getByRole("button", { name: "Menu" }).click();
  await expect(ben.page.getByRole("switch", { name: "Sound" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("Sound turned off in another tab applies here too, as Theme does", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben", { beforeOpen: stubAudio });
  await ben.heading.click(); // the sound is ready

  // A second tab in Ben's browser, on the landing page so it doesn't take
  // the room over, turns Sound off; Ben's room tab never opens its Menu.
  const other = await ben.page.context().newPage();
  await other.goto("/");
  await other.evaluate(() =>
    window.localStorage.setItem("planning-poker:sound", "off"),
  );
  await other.close();

  await ada.page.getByRole("button", { name: "Nudge Ben" }).click();
  await expect(ben.page.getByText(BANNER)).toBeVisible();
  expect(await audio(ben.page)).toEqual({ created: 1, notes: 0 });
  await ben.page.getByRole("button", { name: "Menu" }).click();
  await expect(ben.page.getByRole("switch", { name: "Sound" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("with the browser's own audio, a nudge logs no error or warning", async ({
  people,
  baseURL,
}) => {
  const roomId = await newRoom(baseURL ?? "");
  const ada = await people.join(roomId, "Ada", { facilitate: true });
  const ben = await people.join(roomId, "Ben");
  const errors: string[] = [];
  ben.page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  await ben.heading.click();
  await ada.page.getByRole("button", { name: "Nudge Ben" }).click();
  await expect(ben.page.getByText(BANNER)).toBeVisible();
  // The chime's 300 ms, played out.
  await ben.page.waitForTimeout(400);
  expect(errors).toEqual([]);
});
