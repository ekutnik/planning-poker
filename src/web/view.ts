import type { Card } from "../shared/deck.js";
import type { RoomAction } from "./connection/room-connection.js";
import type { ConnectionState } from "./connection/room-connection.js";
import type { StopReason } from "./connection/policy.js";
import { STOP_COPY } from "./copy.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
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

/** A line above the room while the connection is not open; null when it is. */
export function bannerFor(state: ConnectionState): string | null {
  switch (state.status) {
    case "open":
    case "stopped":
      return null;
    case "connecting":
      return state.snapshot === null ? "Joining the room…" : "Reconnecting…";
    case "reconnecting":
      return "Connection lost. Reconnecting…";
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
};

/** The reveal's results as plain lines of text, until Session 6 designs them. */
export function resultLines(
  snapshot: Extract<RoomSnapshot, { phase: "revealed" }>,
): string[] {
  const { results, participants } = snapshot;
  const nameOf = (id: string) =>
    participants.find((participant) => participant.id === id)?.name ??
    "Someone";
  const lines = [
    `${results.voteCount} ${results.voteCount === 1 ? "vote" : "votes"}`,
    ...results.distribution.map(({ card, count }) => `${card}: ${count}`),
  ];
  if (results.consensus) lines.push("Consensus.");
  else if (results.min !== null && results.max !== null) {
    lines.push(
      `Range ${results.min}–${results.max}` +
        (results.wideSpread ? ", a wide spread." : "."),
    );
  }
  if (results.outliers.length > 0) {
    lines.push(`Outliers: ${results.outliers.map(nameOf).join(", ")}.`);
  }
  return lines;
}
