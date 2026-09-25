import { DECK, type Card } from "../shared/deck.js";

export const MASKED_COPY = {
  recorded: "Vote recorded",
  invalid: "Not a card on the deck",
} as const;

/** Every deck value, plus "c" for ☕ (easier to type). Null for anything else. */
export function parseMaskedEntry(raw: string): Card | null {
  const entry = raw.trim().toLowerCase();
  if (entry === "c") return "☕";
  return (DECK as readonly string[]).includes(entry) ? (entry as Card) : null;
}

/**
 * What pressing Enter in the masked field does. The field always clears, and
 * the message is fixed copy: it never contains what was typed, so a wrong
 * entry is not echoed onto a shared screen.
 */
export function submitMasked(raw: string): {
  readonly vote: Card | null;
  readonly message: string;
} {
  const vote = parseMaskedEntry(raw);
  return {
    vote,
    message: vote === null ? MASKED_COPY.invalid : MASKED_COPY.recorded,
  };
}
