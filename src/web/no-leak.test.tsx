import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DECK, type Card } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { VotingView } from "./VotingView.js";

/*
 * The screen-level counterpart of the wire-level vote-privacy test: before
 * reveal, the facilitator view must not show the viewer's own card, visually
 * or in accessibility state, because the facilitator's screen is shared.
 */

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;

function snapshot(yourVote: Card | null): Voting {
  return {
    phase: "voting",
    roomId: "abcdefghijk",
    version: 4,
    viewerId: "me",
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
    const stripped = voted
      .replace(/<p class="own-vote-confirmation">[^<]*<\/p>/, "")
      .replace(/<button type="button">Clear my vote<\/button>/, "");
    // The vote also changes Ada's own dot and the counts, which are public.
    const publicParts = (html: string) =>
      html
        .replace(/<ul class="people"[\s\S]*?<\/ul>/, "")
        .replace(/<p class="status">[^<]*<\/p>/, "")
        .replace(/<div class="controls">[\s\S]*?<\/div>/, "");
    expect(publicParts(stripped)).toBe(publicParts(notVoted));
    expect(voted).toContain("You&#x27;ve voted ✓");
  });

  it("keeps the masked field empty, and out of forms and password managers", () => {
    const html = render("13", true);
    const input = /<input[^>]*class="masked"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('value=""');
    expect(input).toContain('type="text"');
    // HTML attribute names are case-insensitive; React writes camelCase.
    expect(input).toMatch(/autocomplete="off"/i);
    expect(input).toMatch(/spellcheck="false"/i);
    expect(input).toContain('data-1p-ignore=""');
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
});
