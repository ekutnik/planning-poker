import type { ErrorCode } from "../shared/protocol.js";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from "../shared/rules.js";
import type { StopReason } from "./connection/policy.js";

/**
 * What to show for each server error. Exhaustive on purpose: a new ErrorCode
 * does not compile until someone writes its copy. null means the UI state
 * already shows it, so the error adds nothing. Copy says what happened and
 * what to do, without apologising.
 */
export const ERROR_COPY: Readonly<Record<ErrorCode, string | null>> = {
  INVALID_NAME: null, // join-phase: the stopped screen explains it
  ROOM_FULL: null, // join-phase
  SERVER_FULL: null, // join-phase
  NOT_CONNECTED: null, // shown as reconnecting
  NOT_JOINED: null, // the client sends room actions only once joined
  ALREADY_JOINED: null, // the client joins once per socket
  VOTING_CLOSED: "The cards are revealed. Start a new round to vote again.",
  NO_VOTES_CAST: "Nobody has voted yet. Pick a card before revealing.",
  UNKNOWN_PARTICIPANT: "This tab lost its seat. Reload the page to rejoin.",
  INVALID_MESSAGE:
    "The server could not read that. Reload the page to get the latest version.",
  RATE_LIMITED: "That was a lot at once. Wait a moment, then try again.",
};

export interface StopCopy {
  readonly title: string;
  readonly body: string;
}

/** Why the client stopped, and what the person can do about it. */
export const STOP_COPY: Readonly<Record<StopReason, StopCopy>> = {
  left: {
    title: "You left the room.",
    body: "Open the room link again to rejoin.",
  },
  superseded: {
    title: "This room is open in another tab.",
    body: "Keep going there, or use this tab instead.",
  },
  outdated: {
    title: "A new version is available.",
    body: "Reload the page to continue.",
  },
  "room-full": {
    title: `This room is full. It holds up to ${MAX_PARTICIPANTS} people.`,
    body: "Try again when someone leaves.",
  },
  "server-full": {
    title: "The server has no room for another game right now.",
    body: "Try again in a few minutes.",
  },
  "invalid-name": {
    title: `Names can be 1 to ${MAX_NAME_LENGTH} characters.`,
    body: "Choose a different name to join.",
  },
};
