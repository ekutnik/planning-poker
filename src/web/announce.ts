import type { RoomSnapshot } from "../shared/snapshot.js";
import { resultCopy } from "./result.js";

type Phase = RoomSnapshot["phase"];

export const NEXT_ROUND = "Next round started.";

/**
 * What the room's live region says after a snapshot. Only a change of phase
 * is announced, whoever caused it: the result at reveal, and "Next round
 * started." when the scale gives way to the deck again. Not a room you join
 * in either phase, and not later snapshots within a phase (someone leaving
 * would otherwise re-read the result), which would make a screen reader
 * chatter.
 */
export function phaseAnnouncement(
  previous: Phase,
  snapshot: RoomSnapshot,
): string {
  if (previous === snapshot.phase) return "";
  return snapshot.phase === "revealed"
    ? resultCopy(snapshot).announcement
    : NEXT_ROUND;
}

const INVISIBLE = " ";

/**
 * A live region speaks only when its text changes, so the same message twice
 * ("Vote recorded", then again) would be silent the second time. Repeating a
 * message toggles an invisible trailing no-break space, which is a change.
 */
export function freshAnnouncement(
  previous: string | null,
  next: string,
): string {
  return previous === next ? next + INVISIBLE : next;
}
