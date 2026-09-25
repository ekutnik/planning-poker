import type { Card } from "../shared/deck.js";

/**
 * Keyboard movement across the deck: arrow keys move focus (wrapping) and
 * Home and End jump. Moving never votes; Space or Enter does (docs/design.md).
 * Returns the new index, or null for a key the deck does not handle.
 */
export function moveFocus(
  index: number,
  key: string,
  count: number,
): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The card that takes the one Tab stop in the deck: the chosen card, as a
 * radiogroup expects, or the first. When the vote is hidden, pass null: the
 * Tab stop must not depend on the vote, or tabbing into the deck would land
 * on the chosen card and show it on a shared screen.
 */
export function tabStop(deck: readonly Card[], shown: Card | null): number {
  return shown === null ? 0 : Math.max(0, deck.indexOf(shown));
}
