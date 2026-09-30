import type { ErrorCode } from "../shared/protocol.js";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from "../shared/rules.js";
import type { StopReason } from "./connection/policy.js";
import type { StopAction } from "./view.js";

/**
 * What to show for each server error. Exhaustive on purpose: a new ErrorCode
 * does not compile until someone writes its copy. null means the UI state
 * already shows it, so the error adds nothing. Copy says what happened and
 * what to do, without apologising, in the words the buttons use.
 */
export const ERROR_COPY: Readonly<Record<ErrorCode, string | null>> = {
  INVALID_NAME: null, // join-phase: the stopped screen explains it
  ROOM_FULL: null, // join-phase
  SERVER_FULL: null, // join-phase
  NOT_CONNECTED: null, // shown as reconnecting
  NOT_JOINED: null, // the client sends room actions only once joined
  ALREADY_JOINED: null, // the client joins once per socket
  VOTING_CLOSED: "Votes are revealed. Start the next round to vote again.",
  NO_VOTES_CAST: "Nobody has voted yet. Choose a card before revealing.",
  UNKNOWN_PARTICIPANT: "This tab lost its seat. Reload the page to rejoin.",
  INVALID_MESSAGE:
    "The server couldn't read that. Reload the page to get the latest version.",
  RATE_LIMITED: "That was a lot at once. Wait a moment, then try again.",
  TICKET_TOO_LONG: "That ticket is too long. Keep it to 120 characters.",
  INVALID_DURATION: "Choose a time from 10 seconds to 10 minutes.",
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
    title: "This room is full.",
    body: `A room holds up to ${MAX_PARTICIPANTS} people. Try again when someone leaves.`,
  },
  "server-full": {
    title: "The server is full right now.",
    body: "Try again in a few minutes.",
  },
  "join-rejected": {
    title: "This tab couldn't join the room.",
    body: "Reload the page to get the latest version, then join again.",
  },
  "invalid-name": {
    title: `Names can be 1 to ${MAX_NAME_LENGTH} characters.`,
    body: "Choose a different name to join.",
  },
};

/** The landing page: create a room, then share its link. */
export const HOME_COPY = {
  heading: "Estimate together",
  intro:
    "Everyone votes on their own screen, and the votes stay hidden until someone reveals them.",
  invite: "You'll get a link to share with your team.",
  submit: "Create a room",
  failed: "The room couldn't be created. Check your connection and try again.",
} as const;

/**
 * The Facilitate switch on the landing and join forms: the same setting as
 * the Menu's Facilitate, worded for someone about to start. Both forms start
 * as this browser last left it, off if it never chose.
 */
export const RUNNING_COPY = {
  label: "I'm running this session",
  note: "Hides your vote so you can share your screen.",
} as const;

/** A room link opened in a browser that has no name yet. */
export const JOIN_COPY = {
  heading: "Join the room",
  intro: "Everyone in the room sees your name.",
  submit: "Join",
} as const;

/** A link that is not a room. The same words as the landing's button. */
export const NOT_FOUND_COPY = {
  title: "There's no room at this link.",
  body: "Check the link, or create a new room.",
  action: HOME_COPY.submit,
} as const;

/** The labels on the stopped screens' one button each. */
export const STOP_ACTION_LABELS = {
  "use-this-tab": "Use this tab",
  reload: "Reload",
  "try-again": "Try again",
  "change-name": "Change name",
  home: "Back to start",
} as const satisfies Readonly<Record<StopAction, string>>;

export const NOT_SAVED_COPY =
  "This browser isn't saving your seat, so reloading will join you as someone new.";

/** The product's name, capitalised as a name; everything else is sentence case. */
export const PRODUCT_NAME = "Planning Poker Session";

/** The header, its Menu and the Facilitate switch. */
export const HEADER_COPY = {
  menu: "Menu",
  facilitate: "Facilitate",
  facilitateNote: "Hides your vote so you can share your screen.",
  facilitating: "Facilitating",
  theme: "Theme",
  leave: "Leave the room",
} as const;

/** Copy link, and what it says after a copy, for a few seconds. */
export const COPY_LINK_COPY = {
  copy: "Copy link",
  copied: "Link copied",
  failed: "Couldn't copy. Copy the address from your browser.",
} as const;

/** The people list while voting, and your own vote in the facilitator view. */
export const PEOPLE_COPY = {
  you: "(you)",
  voted: "Voted",
  notYet: "Not yet",
  away: "Away",
  noVote: "No vote",
  youVoted: "You've voted",
  clearVote: "Clear my vote",
  showVote: "Show my vote",
  hideVote: "Hide my vote",
  /** Followed by the card, as CardText gives it. */
  yourVote: "Your vote:",
} as const;

/** Keep score, in the Menu (facilitator view), and each person's points. */
export const SCORE_COPY = {
  label: "Keep score",
  note: "Shows everyone's points: one when a vote matches the result. For this session only.",
  /** On screen: "1 pt", "3 pts". */
  short: (points: number) => (points === 1 ? "1 pt" : `${String(points)} pts`),
  /** For a screen reader: "1 point", "3 points". */
  spoken: (points: number) =>
    points === 1 ? "1 point" : `${String(points)} points`,
} as const;

/** The ticket being estimated, above the room (Ticket). */
export const TICKET_COPY = {
  label: "Now estimating",
  /** Visible as "Edit"; a screen reader hears "Edit the ticket". */
  edit: "Edit",
  editTarget: "the ticket",
  add: "Add a ticket",
  save: "Save",
  cancel: "Cancel",
  /** Said once when someone else changes the ticket. */
  announce: (ticket: string) => `Now estimating: ${ticket}`,
} as const;

/**
 * The result, one sentence that names no one (docs/design.md, Highlight and
 * sentence): result.ts picks the lines, from the server's results.
 */
export const RESULT_COPY = {
  revealed: "Votes revealed.",
  nobody: "Nobody voted this round.",
  noNumeric: "No numeric votes this round.",
  everyone: (card: string) => `Everyone chose ${card}.`,
  onlyOneVote: (card: string) => `Only one vote: ${card}.`,
  // "Only one vote" would be untrue beside a ? or a ☕.
  onlyOneNumericVote: (card: string) => `Only one numeric vote: ${card}.`,
  spread: (min: string, max: string) => `Spread from ${min} to ${max}.`,
  result: (card: string) => `Result: ${card}.`,
  draw: (cards: string) => `Draw between ${cards}.`,
  // No card won, and why, in the rule's own terms: from four numeric votes
  // on, the lowest and the highest are set aside first.
  noResult: (endsSetAside: boolean) =>
    endsSetAside
      ? "No result: no card has two votes once the lowest and highest vote are set aside."
      : "No result: no card has two votes.",
} as const;

/** The landing preview's one control, and its revealed frame's status. */
export const PREVIEW_COPY = {
  pause: "Pause preview",
  play: "Play preview",
  revealed: "Votes revealed",
} as const;

/**
 * A nudge (ADR 0007): what the person nudged sees, and the facilitator's
 * button. Fixed words: nothing here takes a name, so none can be added.
 */
export const NUDGE_COPY = {
  banner: "The room is waiting for your vote.",
  title: "Your vote, please",
  nudge: "Nudge",
  nudged: "Nudged",
} as const;
