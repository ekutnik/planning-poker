import type { ParticipantId } from "../shared/ids.js";

/**
 * A card's name stack on the scale, in wide (docs/design.md, The revealed
 * room): up to five names above the card, then "+n more", which opens a
 * panel with everyone on it. The list a screen reader hears always holds
 * every name, and the people list shows every vote, so the cap only keeps a
 * consensus from stacking a dozen pills up the page.
 */
export const STACK_CAP = 5;

/** How many of a card's voters the stack hides behind "+n more". */
export function hiddenCount(voters: number): number {
  return Math.max(0, voters - STACK_CAP);
}

/**
 * Whether an open panel still lists its card as it was opened: it closes
 * when the room changes shape (Start next round goes with the whole scale),
 * that is when someone it showed is no longer on that card, by leaving or
 * by a vote that moved, or when the card no longer needs "+n more". Someone
 * arriving on the card just joins the list. Never a stale list.
 */
export function panelStillOpen(
  shown: readonly ParticipantId[],
  voters: readonly ParticipantId[],
): boolean {
  if (hiddenCount(voters.length) === 0) return false;
  const now = new Set(voters);
  return shown.every((id) => now.has(id));
}
