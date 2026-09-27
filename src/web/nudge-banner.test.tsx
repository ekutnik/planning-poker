import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { NUDGE_COPY } from "./copy.js";
import { RoomView } from "./RoomView.js";
import { documentTitle, roomTitleAndBanner } from "./title.js";

const NAMES = ["Ada", "Ben", "Cy", "Dee", "Eli"];

// Cy has been nudged; everyone else has voted.
const room: RoomSnapshot = {
  phase: "voting",
  roomId: "abcdefghijk",
  version: 3,
  viewerId: "Cy",
  yourVote: null,
  participants: NAMES.map((name) => ({
    id: name,
    name,
    status: "connected",
    hasVoted: name !== "Cy",
  })),
};

const render = (nudged: boolean) =>
  renderToStaticMarkup(
    <RoomView
      snapshot={room}
      facilitating={false}
      live
      banner={null}
      notice={null}
      persistent
      nudged={nudged}
      onAction={() => undefined}
    />,
  );

/** The nudge's live region, whole. */
const region = (html: string) =>
  /<div role="status" class="nudge-region">[\s\S]*?<\/div>/.exec(html)?.[0] ??
  "";

describe("the nudge's banner and tab title: one decision", () => {
  it("asks for your vote in both while the nudge stands", () => {
    const { title, banner } = roomTitleAndBanner("1 waiting", true);
    expect(documentTitle(title)).toBe(
      "Your vote, please – Planning Poker Session",
    );
    expect(banner).toBe("The room is waiting for your vote.");
  });

  it("goes back to the round's title, with no banner, once it ends", () => {
    expect(roomTitleAndBanner("1 waiting", false)).toEqual({
      title: "1 waiting",
      banner: null,
    });
  });
});

describe("the nudge banner", () => {
  it("sits above the room's heading, in a live region that takes no focus", () => {
    const html = render(true);
    expect(region(html)).toBe(
      '<div role="status" class="nudge-region"><p class="nudge-banner">The room is waiting for your vote.</p></div>',
    );
    expect(html.indexOf("nudge-region")).toBeLessThan(html.indexOf("<h1"));
    expect(region(html)).not.toMatch(/tabindex|<button|<a /);
  });

  it("keeps the live region in the page, empty, when there is no nudge", () => {
    // A region added with its text already in it is not reliably spoken.
    expect(region(render(false))).toBe(
      '<div role="status" class="nudge-region"></div>',
    );
  });

  it("never says who sent it, or names anyone", () => {
    const banner = region(render(true));
    for (const name of NAMES) expect(banner).not.toContain(name);
    // Structural: the words are fixed strings, not templates that could
    // take a name.
    for (const words of Object.values(NUDGE_COPY)) {
      expect(typeof words).toBe("string");
    }
  });
});
