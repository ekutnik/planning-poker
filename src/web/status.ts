import type { RoomSnapshot } from "../shared/snapshot.js";

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;

export interface RoundStatus {
  /** Who the round waits for: everyone connected, plus anyone away who voted. */
  readonly counted: number;
  readonly voted: number;
  /** Counted people who have not voted, in join order. */
  readonly waitingFor: readonly string[];
  /** Away and without a vote: listed, but the round does not wait for them. */
  readonly away: readonly string[];
  /** "4 of 5 have voted", or "Everyone has voted". */
  readonly participantLine: string;
  /** "Waiting for Cy. Fay is away.", or "Everyone has voted". */
  readonly facilitatorLine: string;
  /** "1 hasn't voted", beside the reveal button; null once everyone has. */
  readonly notVotedLine: string | null;
}

/**
 * Who the round is waiting for (docs/design.md). People who are away and have
 * not voted do not hold it up: nobody waits on a closed laptop. Anyone away
 * who has voted still counts, and grace removal keeps an away seat for 60s,
 * so someone who comes back and votes counts again. Presentation only; the
 * server does not change.
 */
export function roundStatus(snapshot: Voting): RoundStatus {
  const counted = snapshot.participants.filter(
    (p) => p.status === "connected" || p.hasVoted,
  );
  const voted = counted.filter((p) => p.hasVoted).length;
  const waitingFor = counted.filter((p) => !p.hasVoted).map((p) => p.name);
  const away = snapshot.participants
    .filter((p) => p.status === "disconnected" && !p.hasVoted)
    .map((p) => p.name);

  const everyone = waitingFor.length === 0;
  const awaySentence =
    away.length === 0
      ? ""
      : `. ${listNames(away)} ${away.length === 1 ? "is" : "are"} away.`;
  const notVoted = counted.length - voted;

  return {
    counted: counted.length,
    voted,
    waitingFor,
    away,
    participantLine: everyone
      ? "Everyone has voted"
      : `${voted} of ${counted.length} ${voted === 1 ? "has" : "have"} voted`,
    facilitatorLine:
      (everyone
        ? "Everyone has voted"
        : `Waiting for ${listNames(waitingFor)}`) + awaySentence,
    notVotedLine:
      notVoted === 0
        ? null
        : `${notVoted} ${notVoted === 1 ? "hasn't" : "haven't"} voted`,
  };
}

/** "Cy", "Cy and Fay", "Ada, Cy and Fay". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
