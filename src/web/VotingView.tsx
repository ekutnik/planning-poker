import { useRef } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { Deck } from "./Deck.js";
import { PEOPLE_COPY } from "./copy.js";
import { People } from "./People.js";
import { ScreenHeading } from "./ScreenHeading.js";
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
  onHeadingShown,
  onAction,
}: {
  readonly snapshot: Voting;
  readonly facilitating: boolean;
  readonly live: boolean;
  /** See ScreenHeading: the room's live region waits for this (A-06). */
  readonly onHeadingShown?: (tookFocus: boolean) => void;
  readonly onAction: (action: RoomAction) => void;
}) {
  const status = roundStatus(snapshot);
  const deckArea = useRef<HTMLDivElement>(null);
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
      <ScreenHeading className="status" onShown={onHeadingShown}>
        {facilitating ? status.facilitatorLine : status.participantLine}
      </ScreenHeading>
      <People
        participants={snapshot.participants}
        viewerId={snapshot.viewerId}
      />
      {/* The deck's own container, so the deck can choose ten cards in a
          row or two rows of five by the width it actually has. */}
      <div className="deck-area" ref={deckArea}>
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
      </div>
      {/* Your own vote, facilitator view: Clear my vote, then the pill, in
          that order, so the pill does not sit beside the people's pills and
          read as one of them. Nothing before voting: your row says Not yet.
          Never the card: the screen is shared. */}
      {facilitating && hasVoted && (
        <div className="own-vote">
          <button
            type="button"
            disabled={!live}
            onClick={() => {
              // Clearing removes this block, and the focused button with it.
              // Choosing a card is next, so focus goes to the deck's Tab
              // stop: the first card, since this view never marks one.
              deckArea.current
                ?.querySelector<HTMLElement>('[tabindex="0"]')
                ?.focus();
              onAction({ type: "clearVote" });
            }}
          >
            {PEOPLE_COPY.clearVote}
          </button>
          <span className="pill pill--voted">{PEOPLE_COPY.youVoted}</span>
        </div>
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
