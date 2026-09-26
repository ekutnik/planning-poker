import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { CardText } from "./CardText.js";
import { People } from "./People.js";
import { resultCopy } from "./result.js";
import { Scale } from "./Scale.js";
import { ScreenHeading } from "./ScreenHeading.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/**
 * The revealed round: the people list with each card, the deck as the scale,
 * the result in one sentence, and the one next action. Same grid and the
 * same controls position as the voting screen, so nothing jumps at reveal.
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
    <div
      className={`round round--revealed ${
        facilitating ? "round--facilitator" : "round--participant"
      }`}
    >
      <ScreenHeading className="status" onShown={onHeadingShown}>
        Votes revealed
      </ScreenHeading>
      <People
        participants={snapshot.participants}
        viewerId={snapshot.viewerId}
      />
      <Scale snapshot={snapshot} />
      <div className="result">
        <p className={`result-summary result-summary--${copy.tone}`}>
          {copy.summary}
        </p>
        {copy.others.map(({ names, card }) => (
          <p key={card}>
            {names} voted <CardText card={card} />
          </p>
        ))}
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
    </div>
  );
}
