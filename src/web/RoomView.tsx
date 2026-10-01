import { useCallback, useEffect, useState } from "react";
import type { RoomSnapshot } from "../shared/snapshot.js";
import {
  announcementFor,
  phaseAnnouncement,
  type PhaseCopy,
} from "./announce.js";
import { cleanTicket } from "../shared/rules.js";
import { NOT_SAVED_COPY, TICKET_COPY, TIMER_COPY } from "./copy.js";
import { tenSecondsWait, timerAnnouncement, timerSeen } from "./countdown.js";
import { roomTitle, roomTitleAndBanner, useDocumentTitle } from "./title.js";
import type { RoomAction } from "./connection/room-connection.js";
import { RevealedView } from "./RevealedView.js";
import { Ticket } from "./Ticket.js";
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
  nudged = false,
  onAction,
}: {
  readonly snapshot: RoomSnapshot;
  readonly facilitating: boolean;
  readonly live: boolean;
  readonly banner: string | null;
  readonly notice: string | null;
  readonly persistent: boolean;
  /** Someone nudged you, and it still stands (RoomSession). */
  readonly nudged?: boolean;
  readonly onAction: (action: RoomAction) => void;
}) {
  const { title, banner: nudgeBanner } = roomTitleAndBanner(
    roomTitle(snapshot),
    nudged,
  );
  useDocumentTitle(title);

  // The live region must exist before it changes, so it lives here, above
  // both phases. A phase change (React's "adjust state when a prop changes"
  // pattern) leaves what to say pending; the new view's heading then reports
  // whether it took focus, and only then is the text chosen (A-06).
  const [phase, setPhase] = useState(snapshot.phase);
  const [speech, setSpeech] = useState<{
    readonly pending: PhaseCopy | null;
    readonly text: string;
  }>({ pending: null, text: "" });
  if (snapshot.phase !== phase) {
    setPhase(snapshot.phase);
    setSpeech({ pending: phaseAnnouncement(phase, snapshot), text: "" });
  }
  // The ticket, said once through the same region when someone else changes
  // it; your own Save says nothing, since you just typed it. `saved` holds
  // what this screen last sent, until the snapshot shows it.
  const [ticket, setTicket] = useState(snapshot.ticket);
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  if (snapshot.ticket !== ticket) {
    setTicket(snapshot.ticket);
    setSaved(undefined);
    if (snapshot.ticket !== null && snapshot.ticket !== saved) {
      setSpeech({ pending: null, text: TICKET_COPY.announce(snapshot.ticket) });
    }
  }
  // The timer, said once each through the same region: when it starts, and
  // when 10 seconds are left. The countdown itself is never said.
  const [seen, setSeen] = useState(() => timerSeen(snapshot));
  const now = timerSeen(snapshot);
  if (now.state !== seen.state || now.anyVote !== seen.anyVote) {
    setSeen(now);
    const text = timerAnnouncement(seen, snapshot);
    if (text !== null) setSpeech({ pending: null, text });
  }
  const { state: runState, endsAt } = snapshot.timer;
  useEffect(() => {
    if (runState !== "running" || endsAt === null) return;
    const wait = tenSecondsWait(endsAt, Date.now());
    if (wait === null) return;
    const timeout = setTimeout(() => {
      setSpeech({ pending: null, text: TIMER_COPY.tenLeft });
    }, wait);
    return () => clearTimeout(timeout);
  }, [runState, endsAt]);

  const saveTicket = (text: string) => {
    const cleaned = cleanTicket(text);
    if (cleaned !== snapshot.ticket) setSaved(cleaned);
    onAction({ type: "setTicket", text });
  };

  const onHeadingShown = useCallback((tookFocus: boolean) => {
    setSpeech((current) =>
      current.pending === null
        ? current
        : { pending: null, text: announcementFor(tookFocus, current.pending) },
    );
  }, []);

  return (
    <main className="room-screen" aria-busy={!live}>
      <p role="status" className="visually-hidden">
        {speech.text}
      </p>
      {banner && (
        <p role="status" className="room-message">
          {banner}
        </p>
      )}
      {notice && (
        <p role="alert" className="room-message">
          {notice}
        </p>
      )}
      {!persistent && <p className="room-message">{NOT_SAVED_COPY}</p>}
      {/* Always in the page, so the banner appearing is a change it speaks,
          as the room's other live region is (A-06). It takes no focus. */}
      <div role="status" className="nudge-region">
        {nudgeBanner && <p className="nudge-banner">{nudgeBanner}</p>}
      </div>
      <Ticket
        ticket={snapshot.ticket}
        facilitating={facilitating}
        live={live}
        onSave={saveTicket}
      />
      {snapshot.phase === "voting" ? (
        <VotingView
          snapshot={snapshot}
          facilitating={facilitating}
          live={live}
          onHeadingShown={onHeadingShown}
          onAction={onAction}
        />
      ) : (
        <RevealedView
          snapshot={snapshot}
          facilitating={facilitating}
          live={live}
          onHeadingShown={onHeadingShown}
          onAction={onAction}
        />
      )}
    </main>
  );
}
