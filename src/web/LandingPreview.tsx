import { useEffect, useState } from "react";
import { PREVIEW_COPY } from "./copy.js";
import { Deck } from "./Deck.js";
import { useReducedMotion } from "./layout.js";
import { People } from "./People.js";
import { PREVIEW_FRAMES, previewStep } from "./preview.js";
import { resultCopy } from "./result.js";
import { Scale } from "./Scale.js";
import { roundStatus } from "./status.js";

/**
 * The landing's preview: one round, looping, drawn by the room's own
 * components from a script of fake rooms (preview.ts).
 *
 * The fake room is inert: nothing in it takes focus or a click, and it is
 * hidden from screen readers, so a keyboard user never lands in a room that
 * is not there. Pause preview, outside it, is the one control, and stops on
 * the frame showing. With reduced motion there is nothing to pause: the
 * revealed frame shows, still, with no button.
 */
export function LandingPreview({
  reducedMotion,
  initialFrame = 0,
}: {
  /** For tests, which have no window; the browser's setting otherwise. */
  readonly reducedMotion?: boolean;
  readonly initialFrame?: number;
}) {
  const prefersReduced = useReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;
  const [index, setIndex] = useState(initialFrame);
  const [playing, setPlaying] = useState(true);
  const { frame, next } = previewStep(index, playing, reduced);
  const nextFrame = next?.frame ?? null;
  const delay = next?.ms ?? null;

  useEffect(() => {
    if (nextFrame === null || delay === null) return;
    const timer = setTimeout(() => setIndex(nextFrame), delay);
    return () => clearTimeout(timer);
  }, [nextFrame, delay]);

  const room = PREVIEW_FRAMES[frame]?.room;
  const tallest = PREVIEW_FRAMES[0]?.room;
  if (room === undefined || tallest === undefined) return null;
  return (
    <div className="preview">
      <div className="preview-room" inert aria-hidden="true">
        <div className="preview-frame">
          <PreviewRoom room={room} />
        </div>
        {/* A voting frame, the tallest, invisible in the same place: it
            holds the room's height, so nothing beside or below the preview
            (the form, Pause preview) moves as the frames change. */}
        <div className="preview-frame preview-frame--sizer">
          <PreviewRoom room={tallest} />
        </div>
      </div>
      {!reduced && (
        <button
          type="button"
          className="secondary preview-toggle"
          onClick={() => setPlaying(!playing)}
        >
          {playing ? PREVIEW_COPY.pause : PREVIEW_COPY.play}
        </button>
      )}
    </div>
  );
}

/** One fake room, drawn by the room's own components. */
function PreviewRoom({
  room,
}: {
  readonly room: (typeof PREVIEW_FRAMES)[number]["room"];
}) {
  if (room.phase === "voting") {
    return (
      <>
        <p className="preview-status">{roundStatus(room).participantLine}</p>
        <People participants={room.participants} viewerId={room.viewerId} />
        <div className="deck-area">
          <Deck
            shown={room.yourVote}
            disabled={false}
            onChoose={() => undefined}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <p className="preview-status">{PREVIEW_COPY.revealed}</p>
      <div className="scale-area">
        <Scale snapshot={room} />
      </div>
      <p className="result">{resultCopy(room).summary}</p>
    </>
  );
}
