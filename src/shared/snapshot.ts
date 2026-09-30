import type { Card, NumericCard } from "./deck.js";
import type { ParticipantId } from "./ids.js";

/**
 * A participant as seen before reveal. There is deliberately no `vote` field —
 * privacy is enforced by the *shape of the type*, not by remembering to strip a
 * value. Others' card values are simply not representable here.
 */
export interface VotingParticipantView {
  readonly id: ParticipantId;
  readonly name: string;
  readonly status: "connected" | "disconnected";
  readonly hasVoted: boolean;
}

/** A participant as seen after reveal, with the actual card. */
export interface RevealedParticipantView {
  readonly id: ParticipantId;
  readonly name: string;
  readonly status: "connected" | "disconnected";
  readonly vote: Card | null;
}

/**
 * The per-viewer, per-phase snapshot that goes on the wire (ADR 0004). Before
 * reveal a viewer sees only their own vote plus a `hasVoted` boolean for others;
 * after reveal, everyone's card and the computed results. Participants are an
 * array (not a Map — a Map JSON-serialises to `{}`) which also carries join order.
 */
export type RoomSnapshot =
  | {
      readonly phase: "voting";
      readonly roomId: string;
      readonly version: number;
      readonly viewerId: ParticipantId;
      readonly yourVote: Card | null;
      readonly participants: readonly VotingParticipantView[];
      /** The ticket being estimated, the same for everyone; null for none. */
      readonly ticket: string | null;
      readonly scores: Scores | null;
    }
  | {
      readonly phase: "revealed";
      readonly roomId: string;
      readonly version: number;
      readonly viewerId: ParticipantId;
      readonly participants: readonly RevealedParticipantView[];
      readonly results: Results;
      readonly ticket: string | null;
      readonly scores: Scores | null;
    };

/**
 * Keep score: every participant's points, the same for everyone, keyed by
 * the public id each view already shows, 0 for someone without any. The
 * snapshot's `scores` is null while scoring is off, so no score can appear
 * anywhere then; the room keeps them on the server.
 */
export type Scores = Readonly<Record<ParticipantId, number>>;

/**
 * What the room shows at reveal. Computed once on the server (see
 * `src/server/domain/results.ts`) so every client agrees on what "consensus",
 * "spread" and the winning card mean.
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
  /**
   * The winning card by the team's rule (docs/design.md, The winning card):
   * one card for a winner, several for a draw, none when nothing wins. In
   * deck order.
   */
  readonly winners: readonly NumericCard[];
}
