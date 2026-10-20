import type { RoomSnapshot } from "../shared/snapshot.js";
import { resultCopy } from "./result.js";

type Phase = RoomSnapshot["phase"];

export const NEXT_ROUND = "Next round started.";

/** What to say at a phase change: in full, or after the new heading has been read. */
export interface PhaseCopy {
  readonly full: string;
  readonly afterHeading: string;
}

/**
 * What the room's live region says after a snapshot. Only a change of phase
 * is announced, whoever caused it: the result at reveal, and "Next round
 * started." when the scale gives way to the deck again. Not a room you join
 * in either phase, and not later snapshots within a phase (someone leaving
 * would otherwise re-read the result), which would make a screen reader
 * chatter. null means say nothing.
 */
export function phaseAnnouncement(
  previous: Phase,
  snapshot: RoomSnapshot,
): PhaseCopy | null {
  if (previous === snapshot.phase) return null;
  if (snapshot.phase === "revealed") {
    const copy = resultCopy(snapshot);
    return { full: copy.announcement, afterHeading: copy.summary };
  }
  // The new heading says who is missing, not that a round started: no repeat.
  return { full: NEXT_ROUND, afterHeading: NEXT_ROUND };
}

/**
 * A-06: the person whose focus moved to the new heading has just heard it
 * ("Votes revealed"), so the announcement leaves it out and gives only the
 * result. Everyone else, whose focus stayed put, hears it whole. Decided
 * after focus has moved, by the heading's own effect, not predicted.
 */
export function announcementFor(tookFocus: boolean, copy: PhaseCopy): string {
  return tookFocus ? copy.afterHeading : copy.full;
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
