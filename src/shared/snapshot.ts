import type { Card, NumericCard } from "./deck.js";
import type { ParticipantId } from "./ids.js";

/**
 * What the room shows at reveal. Computed once on the server (see
 * `src/server/domain/results.ts`) so every client agrees on what "consensus",
 * "spread" and "outliers" mean.
 */
export interface Results {
  readonly voteCount: number;
  readonly distribution: readonly {
    readonly card: Card;
    readonly count: number;
  }[];
  readonly consensus: boolean;
  readonly min: NumericCard | null;
  readonly max: NumericCard | null;
  readonly spreadSteps: number | null;
  readonly wideSpread: boolean;
  readonly outliers: readonly ParticipantId[];
}
