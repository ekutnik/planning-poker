import { isNumericCard, type Card } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { RESULT_COPY } from "./copy.js";
import { listNames } from "./status.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

export interface ResultCopy {
  /** The one sentence about the numbers, in Ink: the colour is on the scale. */
  readonly summary: string;
  /** What the live region says at reveal: "Votes revealed.", then the sentence. */
  readonly announcement: string;
}

/**
 * The words for a card when it is read rather than seen. Screen readers skip
 * a "?" that ends a sentence, and read ☕ as "hot beverage".
 */
export function spokenCard(card: Card): string {
  switch (card) {
    case "?":
      return "question mark";
    case "☕":
      return "coffee";
    default:
      return card;
  }
}

/**
 * The reveal in words (docs/design.md, Highlight and sentence). Only the
 * server's results are used, so every client says the same thing, and the
 * server alone decides what wins. It names no one: the scale shows who
 * chose what, and a screen reader can read it as a list.
 */
export function resultCopy({ results }: Revealed): ResultCopy {
  const summary = sentence(results);
  return { summary, announcement: `${RESULT_COPY.revealed} ${summary}` };
}

function sentence(results: Revealed["results"]): string {
  const { min, max, winners } = results;
  if (results.voteCount === 0) return RESULT_COPY.nobody;
  if (min === null || max === null) return RESULT_COPY.noNumeric;
  if (results.consensus) return RESULT_COPY.everyone(min);
  const numericVotes = results.distribution
    .filter(({ card }) => isNumericCard(card))
    .reduce((sum, { count }) => sum + count, 0);
  if (numericVotes === 1) {
    return results.voteCount === 1
      ? RESULT_COPY.onlyOneVote(min)
      : RESULT_COPY.onlyOneNumericVote(min);
  }
  // The spread is the full range, dropped votes included, and only when
  // there is one. Two or more numeric votes that agree always win, so the
  // sentence is never empty.
  const parts = min === max ? [] : [RESULT_COPY.spread(min, max)];
  const [winner] = winners;
  if (winners.length === 1 && winner !== undefined) {
    parts.push(RESULT_COPY.result(winner));
  }
  if (winners.length > 1) parts.push(RESULT_COPY.draw(listNames(winners)));
  return parts.join(" ");
}
