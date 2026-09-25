import type { RoomSnapshot } from "../shared/snapshot.js";
import type { RoomAction } from "./connection/room-connection.js";
import { resultLines } from "./view.js";
import { VotingView } from "./VotingView.js";

/**
 * The room: banners, then the voting screen, or the results until PR C turns
 * the deck into the scale. The room id is never shown; Copy link in the
 * header shares it.
 */
export function RoomView({
  snapshot,
  facilitating,
  live,
  banner,
  notice,
  persistent,
  onAction,
}: {
  readonly snapshot: RoomSnapshot;
  readonly facilitating: boolean;
  readonly live: boolean;
  readonly banner: string | null;
  readonly notice: string | null;
  readonly persistent: boolean;
  readonly onAction: (action: RoomAction) => void;
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
      {snapshot.phase === "voting" ? (
        <VotingView
          snapshot={snapshot}
          facilitating={facilitating}
          live={live}
          onAction={onAction}
        />
      ) : (
        <>
          <h2>Participants</h2>
          <ul>
            {snapshot.participants.map((p) => (
              <li key={p.id}>
                {p.name}
                {you(p.id)}: {p.vote ?? "no vote"}
                {p.status === "disconnected" && " (away)"}
              </li>
            ))}
          </ul>
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
            Start next round
          </button>
        </>
      )}
    </main>
  );
}
