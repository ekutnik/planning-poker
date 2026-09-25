import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DECK } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { RevealedView } from "./RevealedView.js";
import { RoomView } from "./RoomView.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

// The wide-spread example from docs/design.md: Ada 3, Ben 8, Cy ?, Dee 8,
// Eli 13, Fay away without a vote.
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
    wideSpread: true,
    outliers: ["Ada", "Eli"],
  },
};

function render(facilitating = true): string {
  return renderToStaticMarkup(
    <RevealedView
      snapshot={snapshot}
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

  it("colours the outliers, and only them, in Discuss", () => {
    const html = render();
    const discuss = [
      ...html.matchAll(/class="scale-name scale-name--discuss">([^<]*)</g),
    ].map(([, name]) => name);
    expect(discuss).toEqual(["Ada", "Eli"]);
    expect(html).not.toContain("scale-name--agree");
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
    const people = /<ul class="people"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
    expect(people).toContain('Ada <span class="person-card">3</span>');
    expect(people).toContain('Dee <span class="person-card">8</span>');
    expect(people).toMatch(
      /Fay<span class="visually-hidden">, no vote<\/span> \(away\)/,
    );
  });
});

describe("the revealed round", () => {
  it("says the result in words, coloured by tone", () => {
    expect(render()).toContain(
      '<p class="result-summary result-summary--discuss">Spread of 3 steps, from 3 to 13. Ada and Eli, talk through your estimates.</p>',
    );
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
