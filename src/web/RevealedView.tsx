import { useRef } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { CardText } from "./CardText.js";
import { useRecoverFocus } from "./focus.js";
import { People } from "./People.js";
import { resultCopy } from "./result.js";
import { Scale } from "./Scale.js";

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
  recoverFocus = false,
  onAction,
}: {
  readonly snapshot: Revealed;
  readonly facilitating: boolean;
  readonly live: boolean;
  /** Set after a phase change: see useRecoverFocus. */
  readonly recoverFocus?: boolean;
  readonly onAction: (action: RoomAction) => void;
}) {
  const copy = resultCopy(snapshot);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useRecoverFocus(statusRef, recoverFocus);
  return (
    <div
      className={`round round--revealed ${
        facilitating ? "round--facilitator" : "round--participant"
      }`}
    >
      <p ref={statusRef} className="status" tabIndex={-1}>
        Votes revealed
      </p>
      <People participants={snapshot.participants} />
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
