import type { Card } from "../../shared/deck.js";
import type { ParticipantId } from "../../shared/ids.js";
import type {
  RevealedParticipantView,
  RoomSnapshot,
  Scores,
  VotingParticipantView,
} from "../../shared/snapshot.js";
import type { Room } from "./room.js";
import { computeResults } from "./results.js";

/**
 * Project room state for a single viewer. Deterministic: the same room and
 * viewer always produce a deep-equal snapshot (participants in join order, no
 * timestamps, stable key order). The transport relies on that determinism to
 * suppress unchanged sends, which is what closes the pre-reveal metadata leak.
 *
 * Every view field is written out explicitly. We deliberately do NOT spread a
 * `Participant` into a view: a spread would copy `vote` past the type check and
 * leak it at runtime (the excess-property check only covers object literals).
 */
export function project(room: Room, viewerId: ParticipantId): RoomSnapshot {
  if (room.phase === "revealed") {
    const participants: RevealedParticipantView[] = [];
    for (const p of room.participants.values()) {
      participants.push({
        id: p.id,
        name: p.name,
        status: p.status,
        vote: p.vote,
      });
    }
    return {
      phase: "revealed",
      roomId: room.id,
      version: room.version,
      viewerId,
      participants,
      results: computeResults(room),
      ticket: room.ticket,
      scores: scoresFor(room),
    };
  }

  const participants: VotingParticipantView[] = [];
  let yourVote: Card | null = null;
  for (const p of room.participants.values()) {
    participants.push({
      id: p.id,
      name: p.name,
      status: p.status,
      hasVoted: p.vote !== null,
    });
    if (p.id === viewerId) yourVote = p.vote;
  }
  return {
    phase: "voting",
    roomId: room.id,
    version: room.version,
    viewerId,
    yourVote,
    participants,
    ticket: room.ticket,
    scores: scoresFor(room),
  };
}

/** Everyone's points in join order, or null while scoring is off. */
function scoresFor(room: Room): Scores | null {
  if (!room.scoring) return null;
  const scores: Record<string, number> = {};
  for (const id of room.participants.keys()) {
    scores[id] = room.scores.get(id) ?? 0;
  }
  return scores;
}
