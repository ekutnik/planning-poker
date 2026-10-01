/**
 * Shared fixtures for the end-to-end suite.
 *
 * One rule for every test: before asserting that something is absent
 * (toHaveCount(0), not.toContainText, a list without an item), first wait
 * for something present from the same update. A check that nothing is
 * there passes the moment it runs, so it can pass before the update it
 * means to check has arrived. The privacy test's "no card chosen" did just
 * that until it waited for "You've voted"; a mutation run caught it.
 */
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

declare global {
  interface Window {
    /** Set by watch(): reports a problem in the page to the test. */
    __e2eReport?: (problem: string) => void;
    /** Set by recordSpeech(): every text the room's live region has held. */
    __e2eSpoken?: string[];
  }
}

/**
 * Fails the test on anything wrong inside the page that no assertion would
 * see: a Content-Security-Policy violation (the built page, its fonts, the
 * WebSocket), or an uncaught error. The listener is added before any of the
 * page's own scripts run, on every page of the context.
 */
export async function watch(
  context: BrowserContext,
  problems: string[],
): Promise<void> {
  await context.exposeBinding("__e2eReport", (_source, problem: string) => {
    problems.push(problem);
  });
  await context.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        window.__e2eReport?.(
          `CSP ${event.effectiveDirective} blocked ` +
            `${event.blockedURI} on ${location.pathname}`,
        );
      },
      true,
    );
  });
  context.on("page", (page) => {
    page.on("pageerror", (error) => {
      problems.push(`uncaught error: ${error.message}`);
    });
  });
}

/** The WebSocket messages a page sent and received, parsed. */
export interface Frames {
  readonly sent: Record<string, unknown>[];
  readonly received: Record<string, unknown>[];
}

/** Records every WebSocket frame. Call before the page opens the socket. */
export function recordFrames(page: Page): Frames {
  const frames: Frames = { sent: [], received: [] };
  const parse = (payload: string | Buffer) =>
    JSON.parse(payload.toString()) as Record<string, unknown>;
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => frames.sent.push(parse(payload)));
    socket.on("framereceived", ({ payload }) =>
      frames.received.push(parse(payload)),
    );
  });
  return frames;
}

/** One person: a browser of their own, with their name and view settings. */
export interface Person {
  readonly name: string;
  readonly page: Page;
  readonly frames: Frames;
  /** The screen's one h1. */
  readonly heading: Locator;
  /** A card in the deck, by its label. */
  card(label: string): Locator;
}

export interface PersonOptions {
  /** Stored as the last name used, so a room link joins at once; null asks. */
  readonly name?: string | null;
  /** The facilitator view (the Menu's Facilitate). */
  readonly facilitate?: boolean;
  /** The Menu's Session tools that this browser keeps: Ticket name and Timer. */
  readonly tools?: { readonly ticket?: boolean; readonly timer?: boolean };
  /** A stored theme choice. */
  readonly theme?: "light" | "dark";
  /** Another server, for the restart test. */
  readonly baseURL?: string;
  /** Runs before the page opens: to install a fake clock, say. */
  readonly beforeOpen?: (page: Page) => Promise<void>;
}

export interface People {
  /** Opens `path` in a new browser context, as a new person. */
  open(path: string, options?: PersonOptions): Promise<Person>;
  /** Opens the room as `name`, and waits until they have joined. */
  join(
    roomId: string,
    name: string,
    options?: Omit<PersonOptions, "name">,
  ): Promise<Person>;
}

export function personOn(page: Page, name: string, frames: Frames): Person {
  return {
    name,
    page,
    frames,
    heading: page.getByRole("heading", { level: 1 }),
    card: (label) =>
      page
        .getByRole("toolbar", { name: "Your card" })
        .getByRole("button", { name: label, exact: true }),
  };
}

/**
 * The key that moves focus to the next control. Safari's default, which
 * Playwright's WebKit follows, is that Tab reaches only text fields; Option
 * and Tab reach every control, buttons and links too, as with Safari's
 * "Press Tab to highlight each item" on.
 */
export function tabKey(page: Page, backwards = false): string {
  const browser = page.context().browser()?.browserType().name();
  const tab = browser === "webkit" ? "Alt+Tab" : "Tab";
  return backwards ? `Shift+${tab}` : tab;
}

/** The room's people list, and one person's row in it. */
export function row(page: Page, name: string): Locator {
  return page
    .getByRole("list", { name: "Participants" })
    .getByRole("listitem")
    .filter({ has: page.locator(".person-name", { hasText: name }) });
}

async function newPerson(
  browser: Browser,
  problems: string[],
  contexts: BrowserContext[],
  defaultBaseURL: string,
  options: PersonOptions,
): Promise<{ context: BrowserContext; page: Page; frames: Frames }> {
  const baseURL = options.baseURL ?? defaultBaseURL;
  const stored: { name: string; value: string }[] = [];
  if (options.name) {
    stored.push({ name: "planning-poker:name", value: options.name });
  }
  if (options.facilitate !== undefined) {
    stored.push({
      name: "planning-poker:facilitate:v2",
      value: options.facilitate ? "on" : "off",
    });
  }
  if (options.tools) {
    stored.push({
      name: "planning-poker:tools:v1",
      value: JSON.stringify(options.tools),
    });
  }
  if (options.theme) {
    stored.push({ name: "planning-poker:theme", value: options.theme });
  }
  const context = await browser.newContext({
    baseURL,
    storageState: {
      cookies: [],
      origins: [{ origin: baseURL, localStorage: stored }],
    },
  });
  contexts.push(context);
  await watch(context, problems);
  const page = await context.newPage();
  return { context, page, frames: recordFrames(page) };
}

/** Makes a room through the API, as the landing's button does. */
export async function newRoom(baseURL: string): Promise<string> {
  const response = await fetch(`${baseURL}/api/rooms`, { method: "POST" });
  const { roomId } = (await response.json()) as { roomId: string };
  return roomId;
}

/**
 * Starts recording what the room's polite live region says: each text it
 * holds, in order, the empty ones left out. Call once the room is shown.
 */
export async function recordSpeech(page: Page): Promise<void> {
  await page.evaluate(() => {
    const region = document.querySelector(
      ".room-screen > p[role=status].visually-hidden",
    );
    if (region === null) throw new Error("no live region");
    window.__e2eSpoken = [];
    new MutationObserver(() => {
      const text = region.textContent;
      if (text) window.__e2eSpoken?.push(text);
    }).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
}

export function spoken(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__e2eSpoken ?? []);
}

export const test = base.extend<{ problems: string[]; people: People }>({
  // Collected across every page of the test, and checked when it ends.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires the pattern
  problems: async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
    expect(problems, "CSP violations and uncaught errors").toEqual([]);
  },
  context: async ({ context, problems }, use) => {
    await watch(context, problems);
    await use(context);
  },
  people: async ({ browser, problems, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    const base = baseURL ?? "";
    await use({
      open: async (path, options = {}) => {
        const { page, frames } = await newPerson(
          browser,
          problems,
          contexts,
          base,
          options,
        );
        await options.beforeOpen?.(page);
        await page.goto(path);
        return personOn(page, options.name ?? "", frames);
      },
      join: async (roomId, name, options = {}) => {
        const { page, frames } = await newPerson(
          browser,
          problems,
          contexts,
          base,
          { ...options, name },
        );
        await options.beforeOpen?.(page);
        await page.goto(`/r/${roomId}`);
        await expect(row(page, name)).toBeVisible();
        return personOn(page, name, frames);
      },
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };
