import { describe, expect, it } from "vitest";
import type { Card } from "../shared/deck.js";
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
 * A revealed snapshot from [name, card] pairs in join order. The results are
 * written out per case, as the server would compute them (its own tests
 * cover that); the web may not import server code.
 */
function revealed(
  results: Partial<Results>,
  ...votes: [string, Card | null][]
): Revealed {
  const participants = votes.map(([name, vote]) => ({
    id: name,
    name,
    status: "connected" as const,
    vote,
  }));
  return {
    phase: "revealed",
    roomId: "abcdefghijk",
    version: 5,
    viewerId: "Ada",
    participants,
    results: {
      voteCount: votes.filter(([, vote]) => vote !== null).length,
      distribution: [],
      consensus: false,
      min: null,
      max: null,
      spreadSteps: null,
      wideSpread: false,
      outliers: [],
      winners: [],
      ...results,
    },
  };
}

describe("resultCopy: the reveal in words", () => {
  it("says consensus in Agree", () => {
    const copy = resultCopy(
      revealed(
        { consensus: true, min: "5", max: "5", spreadSteps: 0 },
        ["Ada", "5"],
        ["Ben", "5"],
        ["Cy", "5"],
      ),
    );
    expect(copy).toMatchObject({ summary: "Everyone chose 5.", tone: "agree" });
    expect(copy.announcement).toBe("Votes revealed. Everyone chose 5.");
  });

  it("calls one step apart close, in plain Ink", () => {
    const copy = resultCopy(
      revealed(
        { min: "3", max: "5", spreadSteps: 1 },
        ["Ada", "3"],
        ["Ben", "5"],
        ["Cy", "5"],
      ),
    );
    expect(copy).toMatchObject({ summary: "Close: 3 and 5.", tone: "neutral" });
  });

  it("names the outliers on a wide spread, in Discuss", () => {
    const copy = resultCopy(
      revealed(
        {
          min: "3",
          max: "13",
          spreadSteps: 3,
          wideSpread: true,
          outliers: ["Ada", "Eli"],
          winners: [],
        },
        ["Ada", "3"],
        ["Ben", "8"],
        ["Cy", "?"],
        ["Dee", "8"],
        ["Eli", "13"],
      ),
    );
    expect(copy).toMatchObject({
      summary:
        "Spread of 3 steps, from 3 to 13. Ada and Eli, talk through your estimates.",
      tone: "discuss",
    });
  });

  it("says who chose each non-numeric card, in deck order", () => {
    const copy = resultCopy(
      revealed(
        { min: "5", max: "5", spreadSteps: 0 },
        ["Ada", "☕"],
        ["Ben", "5"],
        ["Cy", "?"],
        ["Dee", "5"],
        ["Eli", "?"],
      ),
    );
    expect(copy.others).toEqual([
      { names: "Cy and Eli", card: "?" },
      { names: "Ada", card: "☕" },
    ]);
  });

  it("does not call it consensus when a ? sits beside an agreed number", () => {
    const copy = resultCopy(
      revealed(
        { min: "5", max: "5", spreadSteps: 0 },
        ["Ada", "5"],
        ["Ben", "5"],
        ["Cy", "?"],
      ),
    );
    expect(copy).toMatchObject({
      summary: "All numbers agree: 5.",
      tone: "neutral",
    });
  });

  it("names a single numeric voter", () => {
    expect(
      resultCopy(
        revealed(
          { min: "8", max: "8", spreadSteps: 0 },
          ["Ada", "8"],
          ["Ben", null],
        ),
      ).summary,
    ).toBe("Only Ada voted: 8.");
    expect(
      resultCopy(
        revealed(
          { min: "8", max: "8", spreadSteps: 0 },
          ["Ada", "8"],
          ["Ben", "?"],
        ),
      ).summary,
    ).toBe("Only Ada chose a number: 8.");
  });

  it("tells no numeric votes from no votes at all", () => {
    expect(resultCopy(revealed({}, ["Ada", "?"], ["Ben", "☕"])).summary).toBe(
      "No numeric votes this round.",
    );
    expect(resultCopy(revealed({}, ["Ada", null], ["Ben", null])).summary).toBe(
      "Nobody voted this round.",
    );
  });

  it("speaks ? and ☕ as words, and says everything that is on screen", () => {
    const copy = resultCopy(
      revealed(
        {
          min: "3",
          max: "13",
          spreadSteps: 3,
          wideSpread: true,
          outliers: ["Ada", "Ben"],
          winners: [],
        },
        ["Ada", "3"],
        ["Ben", "13"],
        ["Cy", "?"],
        ["Dee", "☕"],
      ),
    );
    expect(copy.announcement).toBe(
      "Votes revealed. Spread of 3 steps, from 3 to 13. Ada and Ben, talk " +
        "through your estimates. Cy voted question mark. Dee voted coffee.",
    );
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
    { consensus: true, min: "5", max: "5", spreadSteps: 0 },
    ["Ada", "5"],
    ["Ben", "5"],
  );
  const voting: RoomSnapshot = {
    phase: "voting",
    roomId: "abcdefghijk",
    version: 6,
    viewerId: "Ada",
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
    full: "Votes revealed. Close: 3 and 5. Cy voted question mark.",
    afterHeading: "Close: 3 and 5. Cy voted question mark.",
  };

  it("leaves out what the heading that took focus has just said", () => {
    expect(announcementFor(true, copy)).toBe(
      "Close: 3 and 5. Cy voted question mark.",
    );
  });

  it("says it whole to everyone whose focus stayed put", () => {
    expect(announcementFor(false, copy)).toBe(copy.full);
  });

  it("keeps the whole result either way, only the heading's words differ", () => {
    const revealedCopy = phaseAnnouncement(
      "voting",
      revealed(
        { min: "3", max: "5", spreadSteps: 1 },
        ["Ada", "3"],
        ["Ben", "5"],
        ["Cy", "?"],
      ),
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
