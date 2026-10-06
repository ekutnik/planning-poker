import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { isolate } from "./isolate.js";
import { RevealedView } from "./RevealedView.js";
import { VotingView } from "./VotingView.js";

/*
 * A name on screen is either an element of its own with dir="auto", or
 * isolated inside a sentence (#80). Each screen that shows names is
 * rendered with names found nowhere else in the markup, and every place
 * one appears, text or attribute, must be one of the two: so a name put
 * into a string without isolate() fails here, wherever it is.
 */

// An Arabic name, Ali, among Latin ones; none of them is a word the copy uses.
const ALI = "\u0639\u0644\u064A";
const NAMES = ["Zayd", "Quinn", ALI, "Xia", "Yusuf"];

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;
type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

const timer = {
  durationMs: 60_000,
  state: "idle",
  endsAt: null,
  remainingMs: null,
} as const;

// Zayd is the viewer; Quinn and Ali haven't voted, Xia has, Yusuf is away.
const voting: Voting = {
  phase: "voting",
  roomId: "abcdefghijk",
  version: 4,
  viewerId: "p1",
  ticket: null,
  scores: null,
  timer,
  yourVote: null,
  participants: [
    { id: "p1", name: "Zayd", status: "connected", hasVoted: false },
    { id: "p2", name: "Quinn", status: "connected", hasVoted: false },
    { id: "p3", name: ALI, status: "connected", hasVoted: false },
    { id: "p4", name: "Xia", status: "connected", hasVoted: true },
    { id: "p5", name: "Yusuf", status: "disconnected", hasVoted: false },
  ],
};

const revealed: Revealed = {
  phase: "revealed",
  roomId: "abcdefghijk",
  version: 5,
  viewerId: "p1",
  ticket: null,
  scores: null,
  timer,
  revealCause: null,
  participants: [
    { id: "p1", name: "Zayd", status: "connected", vote: "5" },
    { id: "p2", name: "Quinn", status: "connected", vote: "5" },
    { id: "p3", name: ALI, status: "connected", vote: "8" },
    { id: "p4", name: "Xia", status: "connected", vote: "?" },
    { id: "p5", name: "Yusuf", status: "disconnected", vote: null },
  ],
  results: {
    voteCount: 4,
    distribution: [
      { card: "5", count: 2 },
      { card: "8", count: 1 },
      { card: "?", count: 1 },
    ],
    consensus: false,
    min: "5",
    max: "8",
    spreadSteps: 1,
    winners: ["5"],
  },
};

const screens: [string, string][] = [true, false].flatMap((facilitating) => {
  const who = facilitating ? "facilitator" : "participant";
  return [
    [
      `voting, ${who}`,
      renderToStaticMarkup(
        <VotingView
          snapshot={voting}
          facilitating={facilitating}
          live
          onAction={() => undefined}
        />,
      ),
    ],
    [
      `revealed, ${who}`,
      renderToStaticMarkup(
        <RevealedView
          snapshot={revealed}
          facilitating={facilitating}
          live
          onAction={() => undefined}
        />,
      ),
    ],
  ];
});

/** Where `name` appears in `html`, and how many of those are allowed. */
function count(html: string, name: string): { all: number; allowed: number } {
  const all = html.split(name).length - 1;
  const own = html.split(`dir="auto">${name}<`).length - 1;
  const isolated = html.split(isolate(name)).length - 1;
  return { all, allowed: own + isolated };
}

describe("names on screen (#80)", () => {
  it.each(screens)(
    "are each in an element of their own with dir=auto, or isolated: %s",
    (_, html) => {
      for (const name of NAMES) {
        const { all, allowed } = count(html, name);
        expect({ name, all }).toEqual({ name, all: allowed });
      }
    },
  );

  it("finds the names it checks: every one appears on some screen", () => {
    for (const name of NAMES) {
      expect(screens.some(([, html]) => html.includes(name))).toBe(true);
    }
  });

  it("isolates each name in the facilitator's status line, and only the names", () => {
    const html = screens[0]?.[1] ?? "";
    expect(html).toContain(
      `Waiting for ${isolate("Zayd")}, ${isolate("Quinn")} and ${isolate(ALI)}. ${isolate("Yusuf")} is away.`,
    );
  });
});
