import type { Card } from "../shared/deck.js";
import { CardText } from "./CardText.js";
import { PEOPLE_COPY } from "./copy.js";

/**
 * Whether the facilitator's own vote stays shown. It hides itself whenever
 * there is no vote (Clear my vote, a new round) and when the facilitator
 * view is switched off, so it never carries over; the voting screen goes at
 * each reveal, and a reload starts hidden, since it is never stored or sent.
 */
export function stillShown(
  shown: boolean,
  facilitating: boolean,
  yourVote: Card | null,
): boolean {
  return shown && facilitating && yourVote !== null;
}

/**
 * Your own vote, facilitator view: Clear my vote, Show my vote, then the
 * pill, in that order, so the pill does not sit beside the people's pills
 * and read as one of them. Hidden, the pill only says a vote exists; shown,
 * it names the card. The deck never marks it either way.
 */
export function OwnVote({
  vote,
  shown,
  live,
  onClear,
  onToggle,
}: {
  readonly vote: Card;
  readonly shown: boolean;
  readonly live: boolean;
  readonly onClear: () => void;
  readonly onToggle: () => void;
}) {
  return (
    <div className="own-vote">
      <button type="button" disabled={!live} onClick={onClear}>
        {PEOPLE_COPY.clearVote}
      </button>
      {/* The name says what a press does, so no aria-pressed; the same
          button stays, so focus stays on it. Local only: works offline. */}
      <button type="button" className="show-vote" onClick={onToggle}>
        {shown ? <EyeOff /> : <Eye />}
        {shown ? PEOPLE_COPY.hideVote : PEOPLE_COPY.showVote}
      </button>
      <span className="pill pill--voted">
        {shown ? (
          <>
            {PEOPLE_COPY.yourVote} <CardText card={vote} />
          </>
        ) : (
          PEOPLE_COPY.youVoted
        )}
      </span>
    </div>
  );
}

function Eye() {
  return (
    <svg
      className="show-vote-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      className="show-vote-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.1" />
      <path d="M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5.1-1.4" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
