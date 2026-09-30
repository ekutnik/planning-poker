import { describe, expect, it } from "vitest";
import { DECK, type Card } from "../shared/deck.js";
import type { Results, RoomSnapshot } from "../shared/snapshot.js";
import {
  freshAnnouncement,
  announcementFor,
  NEXT_ROUND,
  phaseAnnouncement,
} from "./announce.js";
import { resultCopy, spokenCard } from "./result.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/**
 * A revealed snapshot from votes, one participant per vote, in join order
 * (Ada, Ben, Cy, …; null is someone who did not vote). The distribution is
 * counted here; the rest of the results are written out per case, as the
 * server would compute them (its own tests cover that): the web may not
 * import server code.
 */
function revealed(
  results: Partial<Results>,
  votes: readonly (Card | null)[],
): Revealed {
  const participants = votes.map((vote, i) => {
    const name = NAMES[i] ?? `P${String(i)}`;
    return { id: name, name, status: "connected" as const, vote };
  });
  return {
    phase: "revealed",
    roomId: "abcdefghijk",
    version: 5,
    viewerId: "Ada",
    ticket: null,
    scores: null,
    participants,
    results: {
      voteCount: votes.filter((vote) => vote !== null).length,
      distribution: DECK.map((card) => ({
        card,
        count: votes.filter((vote) => vote === card).length,
      })).filter(({ count }) => count > 0),
      consensus: false,
      min: null,
      max: null,
      spreadSteps: null,
      winners: [],
      ...results,
    },
  };
}

const NAMES = ["Ada", "Ben", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal"];

// docs/design.md, Highlight and sentence: one row per situation.
const table: readonly [string, Revealed, string][] = [
  [
    "everyone chose one number",
    revealed({ consensus: true, min: "5", max: "5", winners: ["5"] }, [
      "5",
      "5",
      "5",
    ]),
    "Everyone chose 5.",
  ],
  [
    "the numbers agree, with a ? beside them",
    revealed({ min: "5", max: "5", winners: ["5"] }, ["5", "5", "?"]),
    "Result: 5.",
  ],
  [
    "a winner",
    revealed({ min: "5", max: "13", winners: ["8"] }, [
      "5",
      "8",
      "8",
      "8",
      "13",
    ]),
    "Spread from 5 to 13. Result: 8.",
  ],
  [
    "a draw",
    revealed({ min: "2", max: "13", winners: ["3", "5"] }, [
      "2",
      "3",
      "3",
      "5",
      "5",
      "13",
    ]),
    "Spread from 2 to 13. Draw between 3 and 5.",
  ],
  [
    "a three-way draw",
    revealed({ min: "1", max: "8", winners: ["2", "3", "5"] }, [
      "1",
      "2",
      "2",
      "3",
      "3",
      "5",
      "5",
      "8",
    ]),
    "Spread from 1 to 8. Draw between 2, 3 and 5.",
  ],
  [
    "no winner, with the ends set aside",
    revealed({ min: "2", max: "13" }, ["2", "3", "5", "8", "13"]),
    "Spread from 2 to 13. No result: no card has two votes once the lowest and highest vote are set aside.",
  ],
  [
    "no winner, from three votes: nothing set aside",
    revealed({ min: "3", max: "8" }, ["3", "5", "8"]),
    "Spread from 3 to 8. No result: no card has two votes.",
  ],
  [
    "a winner from three votes",
    revealed({ min: "5", max: "13", winners: ["13"] }, ["13", "13", "5"]),
    "Spread from 5 to 13. Result: 13.",
  ],
  [
    "a single vote",
    revealed({ min: "8", max: "8" }, ["8", null]),
    "Only one vote: 8.",
  ],
  [
    "a single number, beside a ?",
    revealed({ min: "8", max: "8" }, ["8", "?"]),
    "Only one numeric vote: 8.",
  ],
  [
    "no numeric votes",
    revealed({}, ["?", "☕"]),
    "No numeric votes this round.",
  ],
  ["no votes", revealed({}, [null, null]), "Nobody voted this round."],
];

describe("resultCopy: the reveal in one sentence", () => {
  it.each(table)("%s", (_, snapshot, sentence) => {
    const copy = resultCopy(snapshot);
    expect(copy.summary).toBe(sentence);
    expect(copy.announcement).toBe(`Votes revealed. ${sentence}`);
  });

  it("names no one", () => {
    for (const [, snapshot] of table) {
      const { summary } = resultCopy(snapshot);
      for (const { name } of snapshot.participants) {
        expect(summary).not.toContain(name);
      }
    }
  });

  it("leaves the non-numeric votes to the scale, and says none of the removed lines", () => {
    for (const [, snapshot] of table) {
      expect(resultCopy(snapshot).announcement).not.toMatch(
        /voted (question mark|coffee)|Close:|agree:|talk through|chose a number|Most votes/,
      );
    }
  });

  it.each([
    ["?", "question mark"],
    ["☕", "coffee"],
    ["13", "13"],
  ] as const)("reads %s as %j", (card, words) => {
    expect(spokenCard(card)).toBe(words);
  });
});

describe("phaseAnnouncement: only a change of phase is announced", () => {
  const result = revealed(
    { consensus: true, min: "5", max: "5", spreadSteps: 0, winners: ["5"] },
    ["5", "5"],
  );
  const voting: RoomSnapshot = {
    phase: "voting",
    roomId: "abcdefghijk",
    version: 6,
    viewerId: "Ada",
    ticket: null,
    scores: null,
    yourVote: null,
    participants: [],
  };

  it("announces the result on the change from voting to revealed", () => {
    expect(phaseAnnouncement("voting", result)).toEqual({
      full: "Votes revealed. Everyone chose 5.",
      afterHeading: "Everyone chose 5.",
    });
  });

  it("stays quiet for later snapshots of the same reveal", () => {
    expect(phaseAnnouncement("revealed", result)).toBeNull();
  });

  it("announces the next round, however it was started", () => {
    // Someone else pressing "Start next round" swaps the scale for the deck:
    // a change a screen reader user must hear about. The new heading names
    // who is missing, so nothing repeats: both versions say it.
    expect(phaseAnnouncement("revealed", voting)).toEqual({
      full: NEXT_ROUND,
      afterHeading: NEXT_ROUND,
    });
    expect(NEXT_ROUND).toBe("Next round started.");
  });

  it("stays quiet within the voting phase", () => {
    expect(phaseAnnouncement("voting", voting)).toBeNull();
  });
});

describe("announcementFor: said once, not twice (A-06)", () => {
  const copy = {
    full: "Votes revealed. Spread from 3 to 13. Result: 5.",
    afterHeading: "Spread from 3 to 13. Result: 5.",
  };

  it("leaves out what the heading that took focus has just said", () => {
    expect(announcementFor(true, copy)).toBe("Spread from 3 to 13. Result: 5.");
  });

  it("says it whole to everyone whose focus stayed put", () => {
    expect(announcementFor(false, copy)).toBe(copy.full);
  });

  it("keeps the whole result either way, only the heading's words differ", () => {
    const revealedCopy = phaseAnnouncement(
      "voting",
      revealed({ min: "3", max: "5", spreadSteps: 1 }, ["3", "5", "?"]),
    );
    expect(revealedCopy).not.toBeNull();
    if (revealedCopy === null) return;
    expect(announcementFor(false, revealedCopy)).toBe(
      `Votes revealed. ${announcementFor(true, revealedCopy)}`,
    );
  });
});

describe("freshAnnouncement", () => {
  it("passes a new message through", () => {
    expect(freshAnnouncement(null, "Vote recorded")).toBe("Vote recorded");
    expect(freshAnnouncement("Not a card on the deck", "Vote recorded")).toBe(
      "Vote recorded",
    );
  });

  it("changes a repeated message invisibly, so it is spoken again", () => {
    const first = freshAnnouncement(null, "Vote recorded");
    const second = freshAnnouncement(first, "Vote recorded");
    const third = freshAnnouncement(second, "Vote recorded");
    expect(second).not.toBe(first);
    expect(second.trim()).toBe("Vote recorded");
    expect(third).not.toBe(second);
  });
});
