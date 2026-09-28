import type { Card } from "../shared/deck.js";
import type { RoomAction } from "./connection/room-connection.js";
import type { ConnectionState } from "./connection/room-connection.js";
import type { StopReason } from "./connection/policy.js";
import { STOP_COPY } from "./copy.js";
import { validName } from "../shared/rules.js";

/** The shared name rule, with the copy to show when it fails. */
export function checkName(
  raw: string,
):
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string } {
  const name = validName(raw);
  return name === null
    ? { ok: false, message: STOP_COPY["invalid-name"].title }
    : { ok: true, name };
}

/** Actions are live only while joined; otherwise the room is shown stale. */
export function canAct(state: ConnectionState): boolean {
  return state.status === "open";
}

/** After a 1001 (#29): the server is restarting, as on a deploy; not a fault. */
const RESTARTING = "The server is restarting. Reconnecting…";

/** A line above the room while the connection is not open; null when it is. */
export function bannerFor(state: ConnectionState): string | null {
  switch (state.status) {
    case "open":
    case "stopped":
      return null;
    case "connecting":
      if (state.restarting) return RESTARTING;
      return state.snapshot === null ? "Joining the room…" : "Reconnecting…";
    case "reconnecting":
      return state.restarting ? RESTARTING : "Connection lost. Reconnecting…";
  }
}

/**
 * The server's state is the truth: the highlighted card comes from yourVote,
 * never from local click state, so clicking it again clears the vote.
 */
export function voteFor(yourVote: Card | null, card: Card): RoomAction {
  return yourVote === card ? { type: "clearVote" } : { type: "castVote", card };
}

export type StopAction =
  "use-this-tab" | "reload" | "try-again" | "change-name" | "home";

/** What each stopped screen offers. Nothing here retries on its own. */
export const STOP_ACTIONS: Readonly<Record<StopReason, StopAction>> = {
  left: "home",
  superseded: "use-this-tab",
  outdated: "reload", // never automatic: a cached old bundle would loop
  "room-full": "try-again",
  "server-full": "try-again",
  "invalid-name": "change-name",
  "join-rejected": "reload",
};
