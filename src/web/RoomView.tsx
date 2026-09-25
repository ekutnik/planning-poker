import { DECK } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { resultLines, voteFor } from "./view.js";

/** The plain room. Session 6 designs it; this only has to work. */
export function RoomView({
  snapshot,
  live,
  banner,
  notice,
  link,
  persistent,
  onAction,
  onLeave,
}: {
  readonly snapshot: RoomSnapshot;
  readonly live: boolean;
  readonly banner: string | null;
  readonly notice: string | null;
  readonly link: string;
  readonly persistent: boolean;
  readonly onAction: (action: RoomAction) => void;
  readonly onLeave: () => void;
}) {
  const you = (id: string) => (id === snapshot.viewerId ? " (you)" : "");
  return (
    <main aria-busy={!live}>
      {banner && <p role="status">{banner}</p>}
      {notice && <p role="alert">{notice}</p>}
      {!persistent && (
        <p>
          This browser is not saving your seat, so reloading joins you as
          someone new.
        </p>
      )}
      <h1>Planning Poker</h1>
      <p>
        Invite your team with this link: <code>{link}</code>
      </p>

      <h2>Participants</h2>
      <ul>
        {snapshot.phase === "voting"
          ? snapshot.participants.map((p) => (
              <li key={p.id}>
                {p.name}
                {you(p.id)}: {p.hasVoted ? "voted" : "thinking"}
                {p.status === "disconnected" && " (away)"}
              </li>
            ))
          : snapshot.participants.map((p) => (
              <li key={p.id}>
                {p.name}
                {you(p.id)}: {p.vote ?? "no vote"}
                {p.status === "disconnected" && " (away)"}
              </li>
            ))}
      </ul>

      {snapshot.phase === "voting" ? (
        <>
          <h2>Your card</h2>
          <div role="group" aria-label="Cards">
            {DECK.map((card) => (
              <button
                key={card}
                type="button"
                aria-pressed={snapshot.yourVote === card}
                disabled={!live}
                onClick={() => onAction(voteFor(snapshot.yourVote, card))}
              >
                {card}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!live}
            onClick={() => onAction({ type: "reveal" })}
          >
            Reveal
          </button>
        </>
      ) : (
        <>
          <h2>Results</h2>
          <ul>
            {resultLines(snapshot).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!live}
            onClick={() => onAction({ type: "reset" })}
          >
            New round
          </button>
        </>
      )}
      <button type="button" onClick={onLeave}>
        Leave
      </button>
    </main>
  );
}
