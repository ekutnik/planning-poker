import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DECK } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { RevealedView } from "./RevealedView.js";
import { RoomView } from "./RoomView.js";
import { Scale } from "./Scale.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

// Ada 3, Ben 8, Cy ?, Dee 8, Eli 13, Fay away without a vote. Dropping one
// vote at each end (3 and 13) leaves 8 and 8: 8 wins.
const snapshot: Revealed = {
  phase: "revealed",
  roomId: "abcdefghijk",
  version: 7,
  viewerId: "Ada",
  ticket: null,
  scores: null,
  timer: { durationMs: 60_000, state: "idle", endsAt: null, remainingMs: null },
  participants: [
    {
      id: "Ada",
      name: "Ada",
      status: "connected",
      vote: "3",
      voteAtReveal: "3",
      changedAfterReveal: false,
    },
    {
      id: "Ben",
      name: "Ben",
      status: "connected",
      vote: "8",
      voteAtReveal: "8",
      changedAfterReveal: false,
    },
    {
      id: "Cy",
      name: "Cy",
      status: "connected",
      vote: "?",
      voteAtReveal: "?",
      changedAfterReveal: false,
    },
    {
      id: "Dee",
      name: "Dee",
      status: "connected",
      vote: "8",
      voteAtReveal: "8",
      changedAfterReveal: false,
    },
    {
      id: "Eli",
      name: "Eli",
      status: "connected",
      vote: "13",
      voteAtReveal: "13",
      changedAfterReveal: false,
    },
    {
      id: "Fay",
      name: "Fay",
      status: "disconnected",
      vote: null,
      voteAtReveal: null,
      changedAfterReveal: false,
    },
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
    .split(/<li class="scale-step[^"]*"[^>]*>/)
    .slice(1)
    .map((step) =>
      [
        ...step.matchAll(
          /<li class="scale-name[^"]*" dir="auto">([^<]*)<\/li>/g,
        ),
      ].map(([, name = ""]) => name),
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
      /class="scale-card"[^>]*>8<\/button><ul class="scale-names"><li[^>]*>Ben<\/li><li[^>]*>Dee<\/li>/,
    );
  });

  it("marks the cards nobody chose as empty, and keeps them in place", () => {
    const html = render();
    expect(html.match(/class="scale-step scale-step--empty"/g)).toHaveLength(6);
  });

  it("makes every card a toggle button in the room, none hidden from screen readers (ADR 0011)", () => {
    const html = render();
    // A button under aria-hidden would be focusable but unheard.
    expect(html).not.toContain('aria-hidden="true"><button');
    const steps = [...html.matchAll(/<li class="(scale-step[^"]*)"([^>]*)>/g)];
    expect(steps).toHaveLength(DECK.length);
    for (const [, className = "", attributes = ""] of steps) {
      expect(attributes, className).not.toContain("aria-hidden");
    }
    const cards = [
      ...html.matchAll(
        /<button type="button" class="scale-card" aria-pressed="(true|false)" tabindex="(-?\d)">/g,
      ),
    ].map(([, pressed, tab]) => [pressed, tab]);
    expect(cards).toHaveLength(DECK.length);
    // Ada voted 3: her card is pressed, and it is the one Tab stop.
    expect(cards[DECK.indexOf("3")]).toEqual(["true", "0"]);
    expect(cards.filter(([pressed]) => pressed === "true")).toHaveLength(1);
    expect(cards.filter(([, tab]) => tab === "0")).toHaveLength(1);
  });

  it("puts the Tab stop on the first card for someone with no vote", () => {
    const html = render(true, { ...snapshot, viewerId: "Fay" });
    const tabs = [
      ...html.matchAll(
        /class="scale-card" aria-pressed="false" tabindex="(-?\d)"/g,
      ),
    ].map(([, tab]) => tab);
    expect(tabs[0]).toBe("0");
    expect(tabs.slice(1).every((tab) => tab === "-1")).toBe(true);
  });

  it("keeps the preview's cards plain, and its empty ones hidden from screen readers (#44)", () => {
    const html = renderToStaticMarkup(<Scale snapshot={snapshot} />);
    expect(html).not.toContain("<button");
    const steps = [...html.matchAll(/<li class="(scale-step[^"]*)"([^>]*)>/g)];
    expect(steps).toHaveLength(DECK.length);
    for (const [, className = "", attributes = ""] of steps) {
      expect(attributes.includes('aria-hidden="true"'), className).toBe(
        className.includes("scale-step--empty"),
      );
    }
  });

  it("tints the winning card, and the names on it, Win; nothing else", () => {
    const html = render();
    expect(html.match(/scale-step--win/g)).toHaveLength(1);
    expect(html).toMatch(
      /<li class="scale-step scale-step--win"><button type="button" class="scale-card"[^>]*>8<\/button>/,
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
        /<li class="scale-step scale-step--draw"><button type="button" class="scale-card"[^>]*>([^<]*)</g,
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

describe("a stack past five names (v1.1)", () => {
  // Twelve on 5, six on ?: one stack well past the cap, one just past it.
  const names = Array.from({ length: 18 }, (_, i) => `P${String(i + 1)}`);
  const crowd: Revealed = {
    ...snapshot,
    participants: names.map((name, i) => ({
      id: name,
      name,
      status: "connected",
      vote: i < 12 ? "5" : "?",
      voteAtReveal: i < 12 ? "5" : "?",
      changedAfterReveal: false,
    })),
  };
  const html = render(true, crowd);
  const stepOf = (card: string) =>
    html
      .split(/<li class="scale-step[^"]*"[^>]*>/)
      .find((step) =>
        new RegExp(
          `^<button type="button" class="scale-card"[^>]*>(?:<span aria-hidden="true">)?${card.replace(/[?]/g, "\\?")}<`,
        ).test(step),
      ) ?? "";

  it("shows five names, nearest the card, and keeps all 12 in the list", () => {
    const step = stepOf("5");
    const shown = [
      ...step.matchAll(/<li class="scale-name" dir="auto">([^<]*)</g),
    ].map(([, name]) => name);
    const over = [
      ...step.matchAll(
        /<li class="scale-name scale-name--over" dir="auto">([^<]*)</g,
      ),
    ].map(([, name]) => name);
    expect(shown).toEqual(names.slice(0, 5));
    expect(over).toEqual(names.slice(5, 12));
  });

  it("ends the stack with +7 more, named for what it shows, closed", () => {
    const step = stepOf("5");
    expect(step).toMatch(
      /<button type="button" class="small-button scale-more-button" aria-label="\+7 more: show all 12 who chose 5" aria-expanded="false" aria-controls="[^"]+">\+7 more<\/button>/,
    );
    expect(step).toMatch(/<div id="[^"]+" class="scale-more-panel" hidden="">/);
  });

  it("says the card as it is said: +1 more: show all 6 who chose question mark", () => {
    expect(stepOf("?")).toContain(
      'aria-label="+1 more: show all 6 who chose question mark"',
    );
    expect(stepOf("?")).toContain(">+1 more</button>");
  });

  it("names each button with its own words first (WCAG 2.5.3, Label in Name)", () => {
    // axe doesn't check this. Voice control matches what is on screen, so
    // "click +7 more" must find the button by its name.
    const buttons = [
      ...html.matchAll(
        /<button[^>]*class="small-button scale-more-button"[^>]*aria-label="([^"]*)"[^>]*>([^<]*)<\/button>/g,
      ),
    ];
    expect(buttons).toHaveLength(2);
    for (const [, name = "", text = ""] of buttons) {
      expect(text).not.toBe("");
      expect(name.startsWith(text)).toBe(true);
    }
  });

  it("lists everyone on the card in its panel, in join order", () => {
    const panel =
      /class="scale-more-panel" hidden="">([\s\S]*?)<\/div>/.exec(
        stepOf("5"),
      )?.[1] ?? "";
    expect(panel).toContain("12 chose 5");
    expect(
      [...panel.matchAll(/<li dir="auto">([^<]*)<\/li>/g)].map(([, n]) => n),
    ).toEqual(names.slice(0, 12));
  });

  it("has no +n more up to five names", () => {
    expect(render()).not.toContain("scale-more");
    expect(render()).not.toContain("scale-name--over");
  });
});

describe("a vote changed after the reveal (ADR 0011)", () => {
  const changed: Revealed = {
    ...snapshot,
    participants: snapshot.participants.map((p) =>
      p.id === "Eli"
        ? { ...p, vote: "3", voteAtReveal: "13", changedAfterReveal: true }
        : p.id === "Cy"
          ? { ...p, vote: "5", voteAtReveal: "?", changedAfterReveal: true }
          : p,
    ),
  };
  const rowOf = (html: string, name: string) =>
    new RegExp(
      `<li class="person"><span class="person-name" dir="auto">${name}</span>([\\s\\S]*?)</li>`,
    ).exec(html)?.[1] ?? "";

  it("strikes the vote at the reveal through, then an arrow, then the new card, and says it in words", () => {
    const row = rowOf(render(true, changed), "Eli");
    expect(row).toBe(
      ' <span class="person-changed"><s class="person-was" aria-hidden="true">13</s><span class="person-arrow" aria-hidden="true">→</span><span class="chip">3</span><span class="visually-hidden">, changed from 13 after the reveal</span></span>',
    );
  });

  it("says ? and ☕ in words there too, and shows them as the chip does (CardText)", () => {
    const row = rowOf(render(true, changed), "Cy");
    expect(row).toContain(", changed from question mark after the reveal");
    expect(row).toContain(
      '<s class="person-was" aria-hidden="true"><span aria-hidden="true">?</span><span class="visually-hidden">question mark</span></s>',
    );
  });

  it("marks a vote from someone who had none at the reveal", () => {
    const late: Revealed = {
      ...snapshot,
      participants: snapshot.participants.map((p) =>
        p.id === "Fay"
          ? {
              ...p,
              status: "connected",
              vote: "8",
              voteAtReveal: null,
              changedAfterReveal: true,
            }
          : p,
      ),
    };
    const row = rowOf(render(true, late), "Fay");
    expect(row).toContain(
      '<s class="person-was" aria-hidden="true">No vote</s>',
    );
    expect(row).toContain(", voted after the reveal");
  });

  it("leaves an unchanged vote as it was: just its chip", () => {
    expect(rowOf(render(true, changed), "Ben")).toBe(
      ' <span class="chip">8</span>',
    );
  });

  it("doesn't invite anyone to change their vote: the sentence is the last line (decided in #111's review)", () => {
    for (const html of [render(true, changed), render(false, changed)]) {
      expect(html).not.toMatch(/Changed your mind|Choose another card/);
      expect(html).toMatch(
        /<p class="result">[^<]*<\/p><div class="controls">/,
      );
    }
  });
});

describe("the revealed people list", () => {
  const people = (html: string) =>
    /<ul class="people people--revealed"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";

  it("gives each person their card in a neutral chip, and Away to someone away without a vote", () => {
    expect(people(render())).toBe(
      '<ul class="people people--revealed" aria-label="Participants">' +
        '<li class="person"><span class="person-name" dir="auto">Ada</span> <span class="person-you">(you)</span> <span class="chip">3</span></li>' +
        '<li class="person"><span class="person-name" dir="auto">Ben</span> <span class="chip">8</span></li>' +
        '<li class="person"><span class="person-name" dir="auto">Cy</span> <span class="chip"><span aria-hidden="true">?</span><span class="visually-hidden">question mark</span></span></li>' +
        '<li class="person"><span class="person-name" dir="auto">Dee</span> <span class="chip">8</span></li>' +
        '<li class="person"><span class="person-name" dir="auto">Eli</span> <span class="chip">13</span></li>' +
        '<li class="person"><span class="person-name" dir="auto">Fay</span> <span class="pill pill--away">Away</span></li>' +
        "</ul>",
    );
  });

  it("keeps colour off the list: no Win or Draw there", () => {
    expect(people(render())).not.toMatch(/win|draw|voted/);
  });

  it("says No vote, in a Not yet pill, for someone here who did not vote", () => {
    const quiet: Revealed = {
      ...snapshot,
      participants: [
        ...snapshot.participants,
        {
          id: "Gus",
          name: "Gus",
          status: "connected",
          vote: null,
          voteAtReveal: null,
          changedAfterReveal: false,
        },
      ],
    };
    expect(people(render(true, quiet))).toContain(
      '<li class="person"><span class="person-name" dir="auto">Gus</span> <span class="pill pill--not-yet">No vote</span></li>',
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
    // The scale's cards are buttons too (ADR 0011); the round's action is
    // the one other.
    expect(html.match(/<button(?![^>]*scale-card)/g)).toHaveLength(1);
    expect(html).toMatch(
      /<div class="controls"><button type="button" class="primary">Start next round<\/button><\/div>$/,
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

describe("the room's fade", () => {
  it("sits on the room's main, which both phases share, not on the round", () => {
    const voting: RoomSnapshot = {
      phase: "voting",
      roomId: snapshot.roomId,
      version: 6,
      viewerId: "Ada",
      ticket: null,
      scores: null,
      timer: {
        durationMs: 60_000,
        state: "idle",
        endsAt: null,
        remainingMs: null,
      },
      yourVote: null,
      participants: [
        { id: "Ada", name: "Ada", status: "connected", hasVoted: false },
      ],
    };
    const room = (shown: RoomSnapshot) =>
      renderToStaticMarkup(
        <RoomView
          snapshot={shown}
          facilitating={false}
          live
          banner={null}
          notice={null}
          persistent
          onAction={() => undefined}
        />,
      );
    // The same element opens the room in both phases, so React keeps it at
    // the reveal and the fade on it does not play again; only the round
    // inside is replaced.
    for (const html of [room(voting), room(snapshot)]) {
      expect(html).toMatch(/^<main class="room-screen" aria-busy="false">/);
    }
    expect(room(voting)).toContain('class="round round--voting');
    expect(room(snapshot)).toContain('class="round round--revealed');
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
