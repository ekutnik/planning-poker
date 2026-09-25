import type { RoomSnapshot } from "../shared/snapshot.js";
import { resultCopy } from "./result.js";

type Phase = RoomSnapshot["phase"];

/**
 * What the room's live region says after a snapshot. Only the change from
 * voting to revealed is announced: not a room that is already revealed when
 * you join, and not later snapshots during the discussion (someone leaving
 * would otherwise re-read the result), which would make a screen reader
 * chatter. "Start next round" clears it.
 */
export function phaseAnnouncement(
  previous: Phase,
  snapshot: RoomSnapshot,
): string {
  return previous === "voting" && snapshot.phase === "revealed"
    ? resultCopy(snapshot).announcement
    : "";
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
