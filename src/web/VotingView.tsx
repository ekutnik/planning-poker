import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { Deck } from "./Deck.js";
import { MaskedVote } from "./MaskedVote.js";
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
  onAction,
}: {
  readonly snapshot: Voting;
  readonly facilitating: boolean;
  readonly live: boolean;
  readonly onAction: (action: RoomAction) => void;
}) {
  const status = roundStatus(snapshot);
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
      className={
        facilitating
          ? "voting voting--facilitator"
          : "voting voting--participant"
      }
    >
      <p className="status">
        {facilitating ? status.facilitatorLine : status.participantLine}
      </p>
      {facilitating && (
        <div className="controls">
          {reveal}
          {status.notVotedLine && (
            <p className="not-voted">{status.notVotedLine}</p>
          )}
        </div>
      )}
      <ul className="people" aria-label="Participants">
        {snapshot.participants.map((p) => (
          <li key={p.id}>
            <span className="dot" aria-hidden="true">
              {p.hasVoted ? "●" : "○"}
            </span>
            {p.name}
            <span className="visually-hidden">
              , {p.hasVoted ? "voted" : "not voted"}
            </span>
            {p.status === "disconnected" && " (away)"}
          </li>
        ))}
      </ul>
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
      {facilitating ? (
        <MaskedVote
          disabled={!live}
          hasVoted={hasVoted}
          onVote={(card) => onAction({ type: "castVote", card })}
          onClear={() => onAction({ type: "clearVote" })}
        />
      ) : (
        <div className="controls">{reveal}</div>
      )}
    </div>
  );
}
