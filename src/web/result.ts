import { DECK, isNumericCard, type Card } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { listNames } from "./status.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/** The colour of the summary: Agree, Discuss, or plain Ink. Words carry it too. */
export type Tone = "agree" | "discuss" | "neutral";

export interface ResultCopy {
  /** The one sentence about the numbers. */
  readonly summary: string;
  readonly tone: Tone;
  /** Who chose each non-numeric card, in deck order: "Cy voted ?". */
  readonly others: readonly {
    readonly names: string;
    readonly card: Card;
  }[];
  /** What the live region says at reveal: the same words, spoken. */
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
 * The reveal in words (docs/design.md, Copy). Only the server's results are
 * used, so every client says the same thing: nothing here that does not map
 * back to a card, and no mean or median.
 */
export function resultCopy(snapshot: Revealed): ResultCopy {
  const { participants } = snapshot;
  const namesFor = (card: Card) =>
    participants.filter((p) => p.vote === card).map((p) => p.name);

  const others = DECK.filter((card) => !isNumericCard(card)).flatMap((card) => {
    const names = namesFor(card);
    return names.length === 0 ? [] : [{ names: listNames(names), card }];
  });

  const { summary, tone } = summarise(snapshot, namesFor);
  const announcement = [
    "Votes revealed.",
    summary,
    ...others.map(({ names, card }) => `${names} voted ${spokenCard(card)}.`),
  ].join(" ");

  return { summary, tone, others, announcement };
}

function summarise(
  { participants, results }: Revealed,
  namesFor: (card: Card) => string[],
): { readonly summary: string; readonly tone: Tone } {
  const { min, max, spreadSteps } = results;
  if (min === null || max === null || spreadSteps === null) {
    return {
      summary:
        results.voteCount === 0
          ? "Nobody voted this round."
          : "No numeric votes this round.",
      tone: "neutral",
    };
  }
  if (results.consensus) {
    return { summary: `Everyone chose ${min}.`, tone: "agree" };
  }
  if (spreadSteps === 0) {
    // One number, but not consensus: a single numeric voter, or a ? or ☕
    // beside an otherwise agreed number.
    const numeric = namesFor(min);
    const summary =
      numeric.length > 1
        ? `All numbers agree: ${min}.`
        : results.voteCount === 1
          ? `Only ${numeric[0] ?? "one person"} voted: ${min}.`
          : `Only ${numeric[0] ?? "one person"} chose a number: ${min}.`;
    return { summary, tone: "neutral" };
  }
  if (!results.wideSpread) {
    return { summary: `Close: ${min} and ${max}.`, tone: "neutral" };
  }
  const nameOf = (id: string) =>
    participants.find((p) => p.id === id)?.name ?? "Someone";
  return {
    summary:
      `Spread of ${spreadSteps} steps, from ${min} to ${max}. ` +
      `${listNames(results.outliers.map(nameOf))}, talk through your estimates.`,
    tone: "discuss",
  };
}
