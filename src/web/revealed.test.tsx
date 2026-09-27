import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DECK } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { RevealedView } from "./RevealedView.js";
import { RoomView } from "./RoomView.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

// Ada 3, Ben 8, Cy ?, Dee 8, Eli 13, Fay away without a vote. Dropping one
// vote at each end (3 and 13) leaves 8 and 8: 8 wins.
const snapshot: Revealed = {
  phase: "revealed",
  roomId: "abcdefghijk",
  version: 7,
  viewerId: "Ada",
  participants: [
    { id: "Ada", name: "Ada", status: "connected", vote: "3" },
    { id: "Ben", name: "Ben", status: "connected", vote: "8" },
    { id: "Cy", name: "Cy", status: "connected", vote: "?" },
    { id: "Dee", name: "Dee", status: "connected", vote: "8" },
    { id: "Eli", name: "Eli", status: "connected", vote: "13" },
    { id: "Fay", name: "Fay", status: "disconnected", vote: null },
  ],
  results: {
    voteCount: 5,
    distribution: [
      { card: "3", count: 1 },
      { card: "8", count: 2 },
      { card: "13", count: 1 },
      { card: "?", count: 1 },
    ],
    consensus: false,
    min: "3",
    max: "13",
    spreadSteps: 3,
    winners: ["8"],
  },
};

function render(facilitating = true, shown: Revealed = snapshot): string {
  return renderToStaticMarkup(
    <RevealedView
      snapshot={shown}
      facilitating={facilitating}
      live
      onAction={() => undefined}
    />,
  );
}

/** The names on each step of the scale, in DOM order. */
function namesPerStep(html: string): string[][] {
  const scale = /<ol class="scale"[^>]*>([\s\S]*)<\/ol>/.exec(html)?.[1] ?? "";
  return scale
    .split(/<li class="scale-step[^"]*">/)
    .slice(1)
    .map((step) =>
      [...step.matchAll(/<li class="scale-name[^"]*">([^<]*)<\/li>/g)].map(
        ([, name = ""]) => name,
      ),
    );
}

describe("the deck as the scale", () => {
  it("keeps every card in deck order, each with the names that chose it", () => {
    const found = namesPerStep(render());
    expect(found).toEqual([
      [],
      [],
      [],
      ["Ada"],
      [],
      ["Ben", "Dee"], // join order: Ben nearest the card
      ["Eli"],
      [],
      ["Cy"], // names sit on non-numeric cards too
      [],
    ]);
    expect(found).toHaveLength(DECK.length);
  });

  it("puts the card before its names, so a screen reader hears the card first", () => {
    const html = render();
    expect(html).toMatch(
      /<span class="scale-card">8<\/span><ul class="scale-names"><li[^>]*>Ben<\/li><li[^>]*>Dee<\/li>/,
    );
  });

  it("marks the cards nobody chose as empty, and keeps them in place", () => {
    const html = render();
    expect(html.match(/class="scale-step scale-step--empty"/g)).toHaveLength(6);
  });

  it("tints the winning card, and the names on it, Win; nothing else", () => {
    const html = render();
    expect(html.match(/scale-step--win/g)).toHaveLength(1);
    expect(html).toMatch(
      /<li class="scale-step scale-step--win"><span class="scale-card">8<\/span>/,
    );
    expect(html).not.toContain("scale-step--draw");
  });

  it("tints every card of a draw Draw, and none Win", () => {
    const draw: Revealed = {
      ...snapshot,
      results: { ...snapshot.results, winners: ["3", "8"] },
    };
    const html = render(true, draw);
    const tinted = [
      ...html.matchAll(
        /<li class="scale-step scale-step--draw"><span class="scale-card">([^<]*)</g,
      ),
    ].map(([, card]) => card);
    expect(tinted).toEqual(["3", "8"]);
    expect(html).not.toContain("scale-step--win");
  });

  it("tints nothing when nothing wins", () => {
    const none: Revealed = {
      ...snapshot,
      results: { ...snapshot.results, winners: [] },
    };
    expect(render(true, none)).not.toMatch(/scale-step--(win|draw)/);
  });

  it("gives ? and ☕ their words for a screen reader", () => {
    const html = render();
    expect(html).toContain(
      '<span aria-hidden="true">?</span><span class="visually-hidden">question mark</span>',
    );
    expect(html).toContain(
      '<span aria-hidden="true">☕</span><span class="visually-hidden">coffee</span>',
    );
  });
});

describe("the revealed people list", () => {
  it("shows each person's card next to their name", () => {
    const html = render();
    const people =
      /<ul class="people[^"]*"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(people).toContain('Ada <span class="person-card">3</span>');
    expect(people).toContain('Dee <span class="person-card">8</span>');
    expect(people).toMatch(
      /Fay<span class="visually-hidden">, no vote<\/span> \(away\)/,
    );
  });
});

describe("the revealed round", () => {
  it("says the result in one sentence, in Ink, naming no one", () => {
    const html = render();
    expect(html).toContain(
      '<p class="result">Spread from 3 to 13. Result: 8.</p>',
    );
    // "Cy voted ?" is gone: the scale shows it.
    expect(html).not.toContain(" voted ");
  });

  it("offers exactly one next action, last in the DOM", () => {
    const html = render();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(
      /<div class="controls"><button type="button" class="primary">Start next round<\/button><\/div><\/div>$/,
    );
    expect(render(false)).toContain('class="secondary">Start next round');
  });
});

describe("the reveal announcement", () => {
  it("says nothing when you join a room that is already revealed", () => {
    const html = renderToStaticMarkup(
      <RoomView
        snapshot={snapshot}
        facilitating={false}
        live
        banner={null}
        notice={null}
        persistent
        onAction={() => undefined}
      />,
    );
    // The region is there, empty, so the next reveal is a change it speaks.
    expect(html).toContain('<p role="status" class="visually-hidden"></p>');
  });
});

describe("the room's heading (A-01)", () => {
  it("is the status line, focusable by script, and never a live region", () => {
    const html = render();
    expect(html).toContain(
      '<h1 class="status" tabindex="-1">Votes revealed</h1>',
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h1[^>]*(role|aria-live)=/);
  });
});
