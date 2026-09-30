import type { Card } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;
type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/** One step of the landing preview: a room as the real screens draw it. */
export interface PreviewFrame {
  readonly room: Voting | Revealed;
  /** How long it shows before the next, when playing. */
  readonly ms: number;
}

const PEOPLE = ["Ada", "Ben", "Cy", "Dee"] as const;
// Ada is the viewer, and chose 5 first. Dropping one vote at each end of
// 5, 5, 5, 8 leaves 5 and 5: 5 wins, with a spread from 5 to 8.
const VOTES: Readonly<Record<(typeof PEOPLE)[number], Card>> = {
  Ada: "5",
  Ben: "8",
  Cy: "5",
  Dee: "5",
};

function voting(voted: readonly string[]): Voting {
  return {
    phase: "voting",
    roomId: "preview",
    version: 0,
    viewerId: "Ada",
    ticket: null,
    yourVote: VOTES.Ada,
    participants: PEOPLE.map((name) => ({
      id: name,
      name,
      status: "connected",
      hasVoted: voted.includes(name),
    })),
  };
}

const revealed: Revealed = {
  phase: "revealed",
  roomId: "preview",
  version: 0,
  viewerId: "Ada",
  ticket: null,
  participants: PEOPLE.map((name) => ({
    id: name,
    name,
    status: "connected",
    vote: VOTES[name],
  })),
  // As the server would compute them for these votes.
  results: {
    voteCount: 4,
    distribution: [
      { card: "5", count: 3 },
      { card: "8", count: 1 },
    ],
    consensus: false,
    min: "5",
    max: "8",
    spreadSteps: 1,
    winners: ["5"],
  },
};

/**
 * One round, about ten seconds: Ada has voted, the others vote one by one,
 * then the reveal holds long enough to read. Fake rooms drawn by the real
 * components, so the preview follows the theme and the tokens and cannot
 * drift from the room.
 */
export const PREVIEW_FRAMES: readonly PreviewFrame[] = [
  { room: voting(["Ada"]), ms: 2000 },
  { room: voting(["Ada", "Ben"]), ms: 1500 },
  { room: voting(["Ada", "Ben", "Dee"]), ms: 1500 },
  { room: voting(["Ada", "Ben", "Dee", "Cy"]), ms: 1500 },
  { room: revealed, ms: 3500 },
];

/** The frame shown, still, to someone who asked for reduced motion. */
export const REVEALED_FRAME = PREVIEW_FRAMES.findIndex(
  ({ room }) => room.phase === "revealed",
);

/**
 * What the preview shows, and when it moves on: never with reduced motion
 * (the revealed frame, still), never while paused (the current frame,
 * still), otherwise after the frame's time, wrapping to the start.
 */
export function previewStep(
  index: number,
  playing: boolean,
  reducedMotion: boolean,
): {
  readonly frame: number;
  readonly next: { frame: number; ms: number } | null;
} {
  if (reducedMotion) return { frame: REVEALED_FRAME, next: null };
  const frame = PREVIEW_FRAMES[index] ?? PREVIEW_FRAMES[0];
  if (!playing || frame === undefined) return { frame: index, next: null };
  return {
    frame: index,
    next: { frame: (index + 1) % PREVIEW_FRAMES.length, ms: frame.ms },
  };
}
