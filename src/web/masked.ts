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

/**
 * How the field hides what is typed. A text field masked with CSS keeps
 * password managers away; a password field would invite them to offer to
 * save the vote. But `-webkit-text-security` is non-standard, and where it
 * is missing a text field would show "13" on the shared screen with no
 * error, so fall back to a password field, which every browser masks.
 * `supports` is CSS.supports, or undefined outside a browser.
 */
export function maskedInputType(
  supports: ((property: string, value: string) => boolean) | undefined,
): "text" | "password" {
  return supports?.("-webkit-text-security", "disc") === true
    ? "text"
    : "password";
}
