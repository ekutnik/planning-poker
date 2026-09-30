import type { ParticipantId } from "../shared/ids.js";
import type { Scores } from "../shared/snapshot.js";

/**
 * Keep score's order: most points first, ties in join order. Without scores
 * (scoring off), join order, the array as it came. Sort is stable, so ties
 * keep the server's join order, and the order changes only when points do,
 * which is at a reveal.
 */
export function byPoints<T extends { readonly id: ParticipantId }>(
  participants: readonly T[],
  scores: Scores | null,
): readonly T[] {
  if (scores === null) return participants;
  const points = (p: T) => scores[p.id] ?? 0;
  return [...participants].sort((a, b) => points(b) - points(a));
}
