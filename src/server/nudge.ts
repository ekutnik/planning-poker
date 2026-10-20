import type { ParticipantId } from "../shared/ids.js";
import { NUDGE_COOLDOWN_MS } from "../shared/rules.js";
import type { Room } from "./domain/room.js";

/** Why a nudge was not delivered. Logged, never sent to anyone. */
export type NudgeRefusal =
  | "NOT_VOTING"
  | "NOT_IN_ROOM"
  | "SELF"
  | "NO_SUCH_PERSON"
  | "AWAY"
  | "HAS_VOTED"
  | "COOLDOWN";

/**
 * Whether a nudge may reach its target, and if not, why (docs/design.md,
 * Nudges; ADR 0007). The room must be voting; the sender must be in it; the
 * target must be someone else in the same room, connected, with no vote;
 * and nobody may have nudged them in the last NUDGE_COOLDOWN_MS (the room
 * service ends a cooldown early when they vote or the round ends).
 *
 * Pure, and outside the domain on purpose: a nudge is transient and never
 * enters room state. The room service keeps the cooldown and sends it.
 */
/**
 * Whom the timer nudges when its time runs out (ADR 0010): everyone in the
 * room who is connected and hasn't voted, while it is voting. The same rule
 * as a person's nudge, without a sender, and without the cooldown: the
 * timer's nudge restarts it instead.
 */
export function timeUpNudges(room: Room): ParticipantId[] {
  if (room.phase !== "voting") return [];
  return [...room.participants.values()]
    .filter((p) => p.status === "connected" && p.vote === null)
    .map((p) => p.id);
}

export function nudgeRefusal(
  room: Room,
  from: ParticipantId,
  to: ParticipantId,
  lastNudgedAt: number | undefined,
  now: number,
): NudgeRefusal | null {
  if (room.phase !== "voting") return "NOT_VOTING";
  if (!room.participants.has(from)) return "NOT_IN_ROOM";
  if (to === from) return "SELF";
  const target = room.participants.get(to);
  if (target === undefined) return "NO_SUCH_PERSON";
  if (target.status !== "connected") return "AWAY";
  if (target.vote !== null) return "HAS_VOTED";
  if (lastNudgedAt !== undefined && now - lastNudgedAt < NUDGE_COOLDOWN_MS) {
    return "COOLDOWN";
  }
  return null;
}
