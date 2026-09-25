import { useState } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { phaseAnnouncement } from "./announce.js";
import type { RoomAction } from "./connection/room-connection.js";
import { RevealedView } from "./RevealedView.js";
import { VotingView } from "./VotingView.js";

/**
 * The room: banners, then the voting screen or the revealed round. The room
 * id is never shown; Copy link in the header shares it.
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
  // The live region must exist before it changes, so it lives here, above
  // both phases. Its text is set only when the phase changes (React's
  // "adjust state when a prop changes" pattern), never on other snapshots.
  const [phase, setPhase] = useState(snapshot.phase);
  const [announcement, setAnnouncement] = useState("");
  if (snapshot.phase !== phase) {
    setPhase(snapshot.phase);
    setAnnouncement(phaseAnnouncement(phase, snapshot));
  }

  return (
    <main aria-busy={!live}>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
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
        <RevealedView
          snapshot={snapshot}
          facilitating={facilitating}
          live={live}
          onAction={onAction}
        />
      )}
    </main>
  );
}
