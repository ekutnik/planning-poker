import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Card } from "../shared/deck.js";
import { OwnVote, stillShown } from "./OwnVote.js";

/**
 * Show my vote (facilitator view): the own-vote row in both states, and the
 * rule that hides it again. The clicks themselves are in the end-to-end
 * suite (e2e/show-my-vote.e2e.ts).
 */

const render = (vote: Card, shown: boolean) =>
  renderToStaticMarkup(
    <OwnVote
      vote={vote}
      shown={shown}
      live
      onClear={() => undefined}
      onToggle={() => undefined}
    />,
  );

const pill = (html: string) =>
  /<span class="pill pill--voted">([\s\S]*?)<\/span><\/div>$/.exec(html)?.[1];
const showButton = (html: string) =>
  /<button type="button" class="show-vote"[^>]*>[\s\S]*?<\/button>/.exec(
    html,
  )?.[0] ?? "";

describe("the own-vote row", () => {
  it("in order: Clear my vote, Show my vote, then the pill", () => {
    const html = render("8", false);
    expect(html.indexOf("Clear my vote")).toBeLessThan(
      html.indexOf("Show my vote"),
    );
    expect(html.indexOf("Show my vote")).toBeLessThan(
      html.indexOf("pill--voted"),
    );
  });

  it("hidden: says only that you've voted", () => {
    expect(pill(render("8", false))).toBe("You&#x27;ve voted");
  });

  it.each([
    ["8", "Your vote: 8"],
    ["13", "Your vote: 13"],
    [
      "?",
      'Your vote: <span aria-hidden="true">?</span><span class="visually-hidden">question mark</span>',
    ],
    [
      "☕",
      'Your vote: <span aria-hidden="true">☕</span><span class="visually-hidden">coffee</span>',
    ],
  ] as const)(
    "shown: names the card %s, in words for a screen reader",
    (vote, text) => {
      expect(pill(render(vote, true))).toBe(text);
    },
  );

  it("names what a press does, with no aria-pressed, and hides its icon", () => {
    const hidden = showButton(render("8", false));
    const shown = showButton(render("8", true));
    expect(hidden).toContain("Show my vote");
    expect(shown).toContain("Hide my vote");
    for (const button of [hidden, shown]) {
      expect(button).not.toContain("aria-pressed");
      expect(button).toMatch(
        /<svg class="show-vote-icon"[^>]*aria-hidden="true"/,
      );
    }
  });

  it("works while offline: showing is local, clearing is not", () => {
    const offline = renderToStaticMarkup(
      <OwnVote
        vote="8"
        shown={false}
        live={false}
        onClear={() => undefined}
        onToggle={() => undefined}
      />,
    );
    expect(offline).toContain(
      '<button type="button" disabled="">Clear my vote',
    );
    expect(showButton(offline)).not.toContain("disabled");
  });
});

describe("stillShown: Show my vote hides itself again", () => {
  it.each([
    {
      why: "stays shown while you keep a vote",
      shown: true,
      facilitating: true,
      vote: "8",
      expected: true,
    },
    {
      why: "a new round, or Clear my vote: no vote",
      shown: true,
      facilitating: true,
      vote: null,
      expected: false,
    },
    {
      why: "Facilitate switched off",
      shown: true,
      facilitating: false,
      vote: "8",
      expected: false,
    },
    {
      why: "never shows by itself",
      shown: false,
      facilitating: true,
      vote: "8",
      expected: false,
    },
  ] as const)("$why", ({ shown, facilitating, vote, expected }) => {
    expect(stillShown(shown, facilitating, vote)).toBe(expected);
  });
});
