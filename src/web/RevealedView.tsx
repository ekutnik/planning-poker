import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { People } from "./People.js";
import { resultCopy } from "./result.js";
import { Scale } from "./Scale.js";
import { ScreenHeading } from "./ScreenHeading.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/**
 * The revealed round: the people list with each card, the deck as the scale,
 * the result in one sentence that names no one, and the one next action.
 * Its children are items of the same round grid as the voting screen's
 * (RoomView), with the next action in the same place, so nothing jumps at
 * reveal.
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
      <ScreenHeading className="status" onShown={onHeadingShown}>
        Votes revealed
      </ScreenHeading>
      <People
        participants={snapshot.participants}
        viewerId={snapshot.viewerId}
        scores={snapshot.scores}
      />
      {/* The scale's own container, so it lays all ten steps across only
          when each has room for a name (docs/design.md). */}
      <div className="scale-area">
        <Scale snapshot={snapshot} />
      </div>
      <p className="result">{copy.summary}</p>
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
