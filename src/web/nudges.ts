import type { ParticipantId } from "../shared/ids.js";
import { NUDGE_COOLDOWN_MS } from "../shared/rules.js";
import type { VotingParticipantView } from "../shared/snapshot.js";

/** Nudges this facilitator has sent: whom, and when. */
export type SentNudges = ReadonlyMap<ParticipantId, number>;

/** A row's nudge control: none, "Nudge", or "Nudged". */
export type NudgeControl = "nudge" | "nudged" | null;

/**
 * Whom the facilitator can nudge (docs/design.md, People list): someone
 * else, connected, who has not voted; not the away, not yourself. "Nudged"
 * while a nudge sent to them stands.
 */
export function nudgeControl(
  person: VotingParticipantView,
  viewerId: ParticipantId,
  sent: SentNudges,
): NudgeControl {
  if (person.id === viewerId) return null;
  if (person.hasVoted || person.status !== "connected") return null;
  return sent.has(person.id) ? "nudged" : "nudge";
}

/**
 * The nudges that still stand: a nudge ends when its person votes or leaves
 * the room, as the server's cooldown does (ADR 0007), so a "Nudge" button
 * that comes back is one the server will deliver. The round ending drops
 * them all, with the voting screen. The same map when nothing ends, so a
 * render can compare.
 */
export function standingNudges(
  sent: SentNudges,
  participants: readonly VotingParticipantView[],
): SentNudges {
  const stands = (id: ParticipantId) =>
    participants.some((p) => p.id === id && !p.hasVoted);
  if ([...sent.keys()].every(stands)) return sent;
  return new Map([...sent].filter(([id]) => stands(id)));
}

/** Drops the nudges whose cooldown has passed at `now`; the same map if none. */
export function expireNudges(sent: SentNudges, now: number): SentNudges {
  const live = [...sent].filter(([, at]) => now - at < NUDGE_COOLDOWN_MS);
  return live.length === sent.size ? sent : new Map(live);
}

/** When the next standing nudge's cooldown passes; null with none. */
export function nextExpiry(sent: SentNudges): number | null {
  if (sent.size === 0) return null;
  return Math.min(...sent.values()) + NUDGE_COOLDOWN_MS;
}
