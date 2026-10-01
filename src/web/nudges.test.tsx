import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NUDGE_COOLDOWN_MS } from "../shared/rules.js";
import type {
  RoomSnapshot,
  VotingParticipantView,
} from "../shared/snapshot.js";
import {
  expireNudges,
  nextExpiry,
  nudgeControl,
  standingNudges,
  type SentNudges,
} from "./nudges.js";
import { People } from "./People.js";
import { VotingView } from "./VotingView.js";

const person = (
  id: string,
  hasVoted = false,
  status: "connected" | "disconnected" = "connected",
): VotingParticipantView => ({ id, name: id, status, hasVoted });

// You are Ada. Ben voted; Cy has not; Fay is away without a vote.
const people = [
  person("Ada"),
  person("Ben", true),
  person("Cy"),
  person("Fay", false, "disconnected"),
];
const none: SentNudges = new Map();

describe("nudgeControl: whom the facilitator can nudge", () => {
  it.each([
    ["yourself", person("Ada"), null],
    ["someone who has voted", person("Ben", true), null],
    ["someone away", person("Fay", false, "disconnected"), null],
    ["someone here who has not voted", person("Cy"), "nudge"],
  ] as const)("%s: %s", (_, who, control) => {
    expect(nudgeControl(who, "Ada", none)).toBe(control);
  });

  it("says Nudged while a nudge to them stands", () => {
    expect(nudgeControl(person("Cy"), "Ada", new Map([["Cy", 0]]))).toBe(
      "nudged",
    );
  });
});

describe("when a sent nudge ends", () => {
  it("ends when its person votes, or leaves; the same map otherwise", () => {
    const sent: SentNudges = new Map([
      ["Cy", 0],
      ["Dee", 0],
    ]);
    expect(standingNudges(sent, [person("Cy"), person("Dee", true)])).toEqual(
      new Map([["Cy", 0]]),
    );
    expect(standingNudges(sent, [person("Cy")])).toEqual(new Map([["Cy", 0]]));
    const still = standingNudges(sent, [person("Cy"), person("Dee")]);
    expect(still).toBe(sent);
  });

  it("ends when the shared cooldown passes, exactly as the server's does", () => {
    const sent: SentNudges = new Map([["Cy", 1_000]]);
    expect(expireNudges(sent, 1_000 + NUDGE_COOLDOWN_MS - 1)).toBe(sent);
    expect(expireNudges(sent, 1_000 + NUDGE_COOLDOWN_MS).size).toBe(0);
    expect(nextExpiry(sent)).toBe(1_000 + NUDGE_COOLDOWN_MS);
    expect(nextExpiry(none)).toBeNull();
  });
});

const list = (sent: SentNudges, live = true) =>
  renderToStaticMarkup(
    <People
      participants={people}
      viewerId="Ada"
      nudges={{ sent, live, onNudge: () => undefined }}
    />,
  );

describe("the Nudge button", () => {
  it("sits before Cy's pill alone, named for Cy", () => {
    const html = list(none);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(
      '<li class="person"><span class="person-name">Cy</span><button type="button" class="person-nudge">Nudge<span class="visually-hidden"> Cy</span></button><span class="pill pill--not-yet">Not yet</span></li>',
    );
  });

  it("reads Nudged once sent, and stays focusable: aria-disabled, never disabled", () => {
    const html = list(new Map([["Cy", 0]]));
    expect(html).toContain(
      '<button type="button" class="person-nudge person-nudge--sent" aria-disabled="true">Nudged<span class="visually-hidden"> Cy</span></button>',
    );
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });

  it("can take focus back as a list, from script only, where buttons can go", () => {
    expect(list(none)).toMatch(
      /^<ul class="people" aria-label="Participants" tabindex="-1">/,
    );
  });

  it("is not there at all for a participant", () => {
    const html = renderToStaticMarkup(
      <People participants={people} viewerId="Ada" />,
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("tabindex");
  });
});

describe("the facilitator's voting screen", () => {
  const snapshot: Extract<RoomSnapshot, { phase: "voting" }> = {
    phase: "voting",
    roomId: "abcdefghijk",
    version: 2,
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
    participants: people,
  };
  const render = (facilitating: boolean) =>
    renderToStaticMarkup(
      <VotingView
        snapshot={snapshot}
        facilitating={facilitating}
        live
        onAction={() => undefined}
      />,
    );

  it("puts the Nudge buttons before the deck in keyboard order", () => {
    const html = render(true);
    expect(html.indexOf('class="person-nudge"')).toBeGreaterThan(0);
    expect(html.indexOf('class="person-nudge"')).toBeLessThan(
      html.indexOf('role="toolbar"'),
    );
  });

  it("offers no Nudge to a participant", () => {
    expect(render(false)).not.toContain("person-nudge");
  });
});
