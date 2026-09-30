import { useEffect, useRef, useState } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { Deck } from "./Deck.js";
import {
  expireNudges,
  nextExpiry,
  standingNudges,
  type SentNudges,
} from "./nudges.js";
import { OwnVote, stillShown } from "./OwnVote.js";
import { People } from "./People.js";
import { ScreenHeading } from "./ScreenHeading.js";
import { roundStatus } from "./status.js";
import { voteFor } from "./view.js";

type Voting = Extract<RoomSnapshot, { phase: "voting" }>;

/**
 * The voting screen, one tree for both layouts (CSS grid areas switch them).
 * In the facilitator view the viewer's own vote is not rendered unless they
 * press Show my vote: the deck gets no selection, ever, clicking a card
 * always casts it (toggling would mean a click on the hidden choice clears
 * it), and until then only "You've voted" says a vote exists. The
 * screen-level no-leak test holds this.
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

  // The nudges this facilitator has sent (ADR 0007). They end with the
  // shared cooldown, when their person votes or leaves, and with the round,
  // since this screen goes at the reveal: the moments the server's
  // cooldown ends, so a Nudge button on screen is one it will deliver.
  const [sent, setSent] = useState<SentNudges>(() => new Map());
  const standing = standingNudges(sent, snapshot.participants);
  if (standing !== sent) setSent(standing);
  const expiry = nextExpiry(standing);
  useEffect(() => {
    if (expiry === null) return;
    const timer = setTimeout(
      () => setSent((current) => expireNudges(current, Date.now())),
      Math.max(0, expiry - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiry]);
  // Show my vote: this screen's own state, never stored or sent.
  const [shown, setShown] = useState(false);
  const keepShown = stillShown(shown, facilitating, snapshot.yourVote);
  if (keepShown !== shown) setShown(keepShown);
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
        scores={snapshot.scores}
        nudges={
          facilitating
            ? {
                sent: standing,
                live,
                onNudge: (participantId) => {
                  onAction({ type: "nudge", participantId });
                  setSent((current) =>
                    new Map(current).set(participantId, Date.now()),
                  );
                },
              }
            : undefined
        }
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
      {/* Your own vote, facilitator view. Nothing before voting: your row
          says Not yet. The card only if you choose to show it: the screen
          is shared. */}
      {facilitating && snapshot.yourVote !== null && (
        <OwnVote
          vote={snapshot.yourVote}
          shown={keepShown}
          live={live}
          onToggle={() => setShown((current) => !current)}
          onClear={() => {
            // Clearing removes this block, and the focused button with it.
            // Choosing a card is next, so focus goes to the deck's Tab
            // stop: the first card, since this view never marks one.
            deckArea.current
              ?.querySelector<HTMLElement>('[tabindex="0"]')
              ?.focus();
            onAction({ type: "clearVote" });
          }}
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
