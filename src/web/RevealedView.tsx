import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { People } from "./People.js";
import { RESULT_COPY } from "./copy.js";
import { pointsNoteShown, resultCopy } from "./result.js";
import { Scale } from "./Scale.js";
import { ScreenHeading } from "./ScreenHeading.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/**
 * The revealed round: the people list with each card, the deck as the scale,
 * the result in one sentence that names no one, and the one next action.
 * Its children are items of the same round grid as the voting screen's
 * (RoomView), in the same places: the status line and the people in the
 * left column, the scale where the deck was, the next action where Reveal
 * votes was. So nothing moves at the reveal but what it adds: the cards go
 * down by the names stacked above them.
 *
 * The cards can be chosen again (ADR 0011): a vote changed now moves the
 * result, never the points. Nothing on screen invites a change: it's for
 * the exceptional case, such as settling a draw. Once one is made, with
 * Keep score on, a line under the sentence says it earned no point.
 */
export function RevealedView({
  snapshot,
  facilitating,
  live,
  onHeadingShown,
  onAction,
}: {
  readonly snapshot: Revealed;
  readonly facilitating: boolean;
  readonly live: boolean;
  /** See ScreenHeading: the room's live region waits for this (A-06). */
  readonly onHeadingShown?: (tookFocus: boolean) => void;
  readonly onAction: (action: RoomAction) => void;
}) {
  const copy = resultCopy(snapshot);
  return (
    <>
      {/* The status line and the people, in the column they had while
          voting (VotingView). */}
      <div className="round-side">
        <ScreenHeading className="status" onShown={onHeadingShown}>
          Votes revealed
        </ScreenHeading>
        <People
          participants={snapshot.participants}
          viewerId={snapshot.viewerId}
          scores={snapshot.scores}
        />
      </div>
      {/* The scale's own container, so it lays all ten steps across only
          when each has room for a name (docs/design.md). */}
      <div className="scale-area">
        <Scale
          snapshot={snapshot}
          live={live}
          onChoose={(card) => onAction({ type: "castVote", card })}
        />
      </div>
      {/* The sentence, and under it, only while Keep score is on and a vote
          has changed since the reveal, why the points didn't move. Not a
          live region: the people list and the sentence already say it. */}
      <div className="result-area">
        <p className="result">{copy.summary}</p>
        {pointsNoteShown(snapshot) && (
          <p className="result-note">{RESULT_COPY.pointsNote}</p>
        )}
      </div>
      <div className="controls">
        <button
          type="button"
          className={facilitating ? "primary" : "secondary"}
          disabled={!live}
          onClick={() => onAction({ type: "reset" })}
        >
          Start next round
        </button>
      </div>
    </>
  );
}
