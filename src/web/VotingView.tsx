import { useRef } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { Deck } from "./Deck.js";
import { useRecoverFocus } from "./focus.js";
import { MaskedVote } from "./MaskedVote.js";
import { People } from "./People.js";
import { roundStatus } from "./status.js";
import { voteFor } from "./view.js";

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;

/**
 * The voting screen, one tree for both layouts (CSS grid areas switch them).
 * In the facilitator view the viewer's own vote is never rendered: the deck
 * gets no selection, clicking a card always casts it (toggling would mean a
 * click on the hidden choice clears it), and only "You've voted ✓" says a
 * vote exists. The screen-level no-leak test holds this.
 */
export function VotingView({
  snapshot,
  facilitating,
  live,
  recoverFocus = false,
  onAction,
}: {
  readonly snapshot: Voting;
  readonly facilitating: boolean;
  readonly live: boolean;
  /** Set after a phase change: see useRecoverFocus. */
  readonly recoverFocus?: boolean;
  readonly onAction: (action: RoomAction) => void;
}) {
  const status = roundStatus(snapshot);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useRecoverFocus(statusRef, recoverFocus);
  const hasVoted =
    snapshot.participants.find((p) => p.id === snapshot.viewerId)?.hasVoted ??
    false;
  const reveal = (
    <button
      type="button"
      className={facilitating ? "primary" : "secondary"}
      disabled={!live}
      onClick={() => onAction({ type: "reveal" })}
    >
      Reveal votes
    </button>
  );

  return (
    <div
      className={`round round--voting ${
        facilitating ? "round--facilitator" : "round--participant"
      }`}
    >
      <p ref={statusRef} className="status" tabIndex={-1}>
        {facilitating ? status.facilitatorLine : status.participantLine}
      </p>
      <People participants={snapshot.participants} />
      <Deck
        shown={facilitating ? null : snapshot.yourVote}
        disabled={!live}
        onChoose={(card) =>
          onAction(
            facilitating
              ? { type: "castVote", card }
              : voteFor(snapshot.yourVote, card),
          )
        }
      />
      {facilitating && (
        <MaskedVote
          disabled={!live}
          hasVoted={hasVoted}
          onVote={(card) => onAction({ type: "castVote", card })}
          onClear={() => onAction({ type: "clearVote" })}
        />
      )}
      {/* Last in the DOM, so keyboard order follows the task: read the
          status, see who is in, vote, then reveal. Wide shows the controls
          top right; grid areas move them without reordering (design.md). */}
      <div className="controls">
        {reveal}
        {facilitating && status.notVotedLine && (
          <p className="not-voted">{status.notVotedLine}</p>
        )}
      </div>
    </div>
  );
}
