import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DECK, type Card } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { VotingView } from "./VotingView.js";

/*
 * The screen-level counterpart of the wire-level vote-privacy test: before
 * reveal, the facilitator view must not show the viewer's own card, visually
 * or in accessibility state, because the facilitator's screen is shared.
 * (The design revision removed the hidden-vote field: the facilitator votes
 * with a click, and nothing on screen shows the vote afterwards.)
 */

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;

function snapshot(yourVote: Card | null): Voting {
  return {
    phase: "voting",
    roomId: "abcdefghijk",
    version: 4,
    viewerId: "me",
    ticket: null,
    yourVote,
    participants: [
      {
        id: "me",
        name: "Ada",
        status: "connected",
        hasVoted: yourVote !== null,
      },
      { id: "b", name: "Ben", status: "connected", hasVoted: true },
      { id: "c", name: "Cy", status: "connected", hasVoted: false },
      { id: "f", name: "Fay", status: "disconnected", hasVoted: false },
    ],
  };
}

function render(yourVote: Card | null, facilitating: boolean): string {
  return renderToStaticMarkup(
    <VotingView
      snapshot={snapshot(yourVote)}
      facilitating={facilitating}
      live
      onAction={() => undefined}
    />,
  );
}

describe("the facilitator view before reveal", () => {
  it.each(DECK)(
    "renders byte-for-byte the same screen when the vote is %s",
    (vote) => {
      // Any attribute, class, text or Tab stop that depended on the vote
      // would make the markup differ from the one for another card.
      expect(render(vote, true)).toBe(render("0", true));
    },
  );

  it("marks no card as chosen, in looks or accessibility state", () => {
    const html = render("13", true);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(DECK.length);
  });

  it("differs from not having voted only by the confirmation", () => {
    const voted = render("13", true);
    const notVoted = render(null, true);
    // Your own vote: Clear my vote, Show my vote and the "You've voted"
    // pill, no card. (The eye icon is checked in own-vote.test.tsx.)
    const ownVote = /<div class="own-vote">[\s\S]*?<\/div>/
      .exec(voted)?.[0]
      .replace(/<svg[\s\S]*?<\/svg>/g, "");
    expect(ownVote).toBe(
      '<div class="own-vote"><button type="button">Clear my vote</button><button type="button" class="show-vote">Show my vote</button><span class="pill pill--voted">You&#x27;ve voted</span></div>',
    );
    // The vote also changes your own row's pill and the counts, which are
    // public.
    const publicParts = (html: string) =>
      html
        .replace(/<div class="own-vote">[\s\S]*?<\/div>/, "")
        .replace(/<ul class="people"[\s\S]*?<\/ul>/, "")
        .replace(/<h1 class="status"[^>]*>[^<]*<\/h1>/, "")
        .replace(/<div class="controls">[\s\S]*?<\/div>/, "");
    expect(publicParts(voted)).toBe(publicParts(notVoted));
  });

  it("puts the round controls last, after the deck and your own vote", () => {
    // Keyboard order follows the task: status, people, vote, then reveal
    // (docs/design.md, The facilitator view).
    const html = render("13", true);
    const controls = html.indexOf('<div class="controls">');
    expect(controls).toBeGreaterThan(html.indexOf('class="own-vote"'));
    expect(controls).toBeGreaterThan(html.indexOf('role="toolbar"'));
    expect(html.indexOf('class="own-vote"')).toBeGreaterThan(-1);
  });

  it.each(DECK)(
    "shows no vote value while Show my vote is not pressed (vote %s)",
    (vote) => {
      // The byte-for-byte test above already implies it; this names it.
      const html = render(vote, true);
      expect(html).not.toContain("Your vote");
      expect(html).toContain("Show my vote");
    },
  );

  it("has no text field to type a vote into, and no form", () => {
    const html = render("13", true);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<form");
  });
});

describe("the participant view, for contrast", () => {
  it("does show the chosen card, so the checks above can see a selection", () => {
    const html = render("13", false);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>13</);
    expect(render("13", false)).not.toBe(render("0", false));
  });

  it("has no own-vote block, and no Show my vote: the chosen card says it", () => {
    expect(render("13", false)).not.toContain("own-vote");
    expect(render("13", false)).not.toContain("Show my vote");
  });
});
