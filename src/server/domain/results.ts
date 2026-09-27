import {
  DECK,
  isNumericCard,
  type Card,
  type NumericCard,
} from "../../shared/deck.js";
import type { ParticipantId } from "../../shared/ids.js";
import type { Results } from "../../shared/snapshot.js";
import type { Room } from "./room.js";

/** Position of a card in the canonical deck order. */
function deckIndex(card: Card): number {
  return DECK.indexOf(card);
}

/**
 * The team's rule for reading a round (docs/design.md, The winning card).
 * Numeric votes only. If they are all one number, at least two of them, it
 * wins. Otherwise drop one vote at each end, one on the lowest card and one
 * on the highest, and the card with the most remaining votes wins if it has
 * at least two; a tie on that count is a draw. Returns the winning cards in
 * deck order: one, several for a draw, or none.
 */
export function winningCards(numeric: readonly NumericCard[]): NumericCard[] {
  const [first] = numeric;
  if (
    first !== undefined &&
    numeric.length >= 2 &&
    numeric.every((card) => card === first)
  ) {
    return [first];
  }
  const remaining = [...numeric]
    .sort((a, b) => deckIndex(a) - deckIndex(b))
    .slice(1, -1);
  // Sorted, so the counts are in deck order, and so are the winners.
  const counts = new Map<NumericCard, number>();
  for (const card of remaining) counts.set(card, (counts.get(card) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  if (top < 2) return [];
  return [...counts].filter(([, count]) => count === top).map(([card]) => card);
}

/**
 * Derive the reveal-time results for a room. Pure: same room in, same results
 * out. Only reports statistics that map back to a card — no mean, no median
 * (a mean of Fibonacci cards isn't a card; a median can fall between two).
 */
export function computeResults(room: Room): Results {
  // Every cast vote, in join order (Map preserves insertion order). A vote from a
  // disconnected participant still counts.
  const cast: { readonly id: ParticipantId; readonly card: Card }[] = [];
  for (const participant of room.participants.values()) {
    if (participant.vote !== null) {
      cast.push({ id: participant.id, card: participant.vote });
    }
  }

  const voteCount = cast.length;

  // Distribution: canonical deck order, only cards that were actually cast.
  const distribution = DECK.map((card) => ({
    card,
    count: cast.filter((entry) => entry.card === card).length,
  })).filter((entry) => entry.count > 0);

  // Consensus: at least two voters, and every cast vote is the same numeric card.
  // A ? or ☕ anywhere breaks it — everyone who voted must have agreed on a number.
  const first = cast[0]?.card;
  const consensus =
    voteCount >= 2 &&
    first !== undefined &&
    isNumericCard(first) &&
    cast.every((entry) => entry.card === first);

  // min / max / spread are over numeric votes only.
  const numeric: NumericCard[] = [];
  for (const entry of cast) {
    if (isNumericCard(entry.card)) numeric.push(entry.card);
  }

  let min: NumericCard | null = null;
  let max: NumericCard | null = null;
  for (const card of numeric) {
    if (min === null || deckIndex(card) < deckIndex(min)) min = card;
    if (max === null || deckIndex(card) > deckIndex(max)) max = card;
  }

  const spreadSteps =
    min !== null && max !== null ? deckIndex(max) - deckIndex(min) : null;
  const wideSpread = spreadSteps !== null && spreadSteps >= 2;

  // Outliers: only meaningful on a wide spread — the min and max voters, the
  // conventional "explain your estimate" set, in join order.
  const outliers: ParticipantId[] = wideSpread
    ? cast
        .filter((entry) => entry.card === min || entry.card === max)
        .map((entry) => entry.id)
    : [];

  return {
    voteCount,
    distribution,
    consensus,
    min,
    max,
    spreadSteps,
    wideSpread,
    outliers,
    winners: winningCards(numeric),
  };
}
