import { useCallback, useLayoutEffect, useRef } from "react";
import type { ParticipantId } from "../shared/ids.js";
import type {
  RevealedParticipantView,
  VotingParticipantView,
} from "../shared/snapshot.js";
import { CardText } from "./CardText.js";
import { NUDGE_COPY, PEOPLE_COPY } from "./copy.js";
import { nudgeControl, type NudgeControl, type SentNudges } from "./nudges.js";

/** The facilitator view's nudges: whom they have nudged, and how to nudge. */
export interface PeopleNudges {
  readonly sent: SentNudges;
  readonly live: boolean;
  readonly onNudge: (participantId: ParticipantId) => void;
}

export type PersonStatus = "voted" | "not-yet" | "away";

/**
 * A person's pill while voting. A vote wins over being away: someone away
 * who has voted still counts, as the status line counts them
 * (docs/design.md, Who the round waits for).
 */
export function personStatus(person: VotingParticipantView): PersonStatus {
  if (person.hasVoted) return "voted";
  return person.status === "disconnected" ? "away" : "not-yet";
}

const STATUS_LABEL: Readonly<Record<PersonStatus, string>> = {
  voted: PEOPLE_COPY.voted,
  "not-yet": PEOPLE_COPY.notYet,
  away: PEOPLE_COPY.away,
};

/**
 * Everyone in the room, in join order. While voting, one row each: the name
 * ("(you)" after your own), then a pill that says Voted, Not yet or Away in
 * words, so colour is never the only signal. After reveal, each person's
 * card sits next to their name in a neutral chip.
 *
 * With `nudges` (the facilitator view, voting), a Nudge button sits before
 * the pill of everyone who can be nudged (nudgeControl). The list can take
 * focus from script, not from Tab: if a focused Nudge button goes because
 * its person voted or left, focus lands here, where it was, not on the page.
 */
export function People({
  participants,
  viewerId,
  nudges,
}: {
  readonly participants: readonly (
    VotingParticipantView | RevealedParticipantView
  )[];
  readonly viewerId: string;
  readonly nudges?: PeopleNudges;
}) {
  const list = useRef<HTMLUListElement>(null);
  // Stable, so a Nudge button's cleanup runs when it goes, not every render.
  const keepFocus = useCallback(() => list.current?.focus(), []);
  const revealed = participants.some((p) => "vote" in p);
  return (
    <ul
      ref={list}
      className={revealed ? "people people--revealed" : "people"}
      aria-label="Participants"
      tabIndex={nudges ? -1 : undefined}
    >
      {participants.map((p) =>
        "vote" in p ? (
          <RevealedPerson key={p.id} person={p} you={p.id === viewerId} />
        ) : (
          <VotingPerson
            key={p.id}
            person={p}
            you={p.id === viewerId}
            control={nudges ? nudgeControl(p, viewerId, nudges.sent) : null}
            nudges={nudges}
            onGone={keepFocus}
          />
        ),
      )}
    </ul>
  );
}

/** One row while voting: the name, "(you)", a Nudge button, the pill. */
function VotingPerson({
  person,
  you,
  control,
  nudges,
  onGone,
}: {
  readonly person: VotingParticipantView;
  readonly you: boolean;
  readonly control: NudgeControl;
  readonly nudges: PeopleNudges | undefined;
  readonly onGone: () => void;
}) {
  const status = personStatus(person);
  return (
    <li className="person">
      {/* "(you)" sits outside the name, so shortening a long name never
          cuts it: it is what tells you which row is yours. The space
          between them is for a screen reader; flex drops it. */}
      <span className="person-name">{person.name}</span>
      {you && (
        <>
          {" "}
          <span className="person-you">{PEOPLE_COPY.you}</span>
        </>
      )}
      {nudges && control !== null && (
        <NudgeButton
          name={person.name}
          sent={control === "nudged"}
          live={nudges.live}
          onNudge={() => nudges.onNudge(person.id)}
          onGone={onGone}
        />
      )}
      <span className={`pill pill--${status}`}>{STATUS_LABEL[status]}</span>
    </li>
  );
}

/**
 * "Nudge Cy", then "Nudged Cy" while the nudge stands: the words on the
 * button, and the person for a screen reader. Nudged is aria-disabled, not
 * disabled, so it keeps keyboard focus in every browser, as the Nudge
 * pressed a moment ago; a click on it does nothing. Rendered only for
 * someone who can be nudged, so this component itself goes when they vote
 * or leave, and React runs its cleanup before the button leaves the page.
 */
function NudgeButton({
  name,
  sent,
  live,
  onNudge,
  onGone,
}: {
  readonly name: string;
  readonly sent: boolean;
  readonly live: boolean;
  readonly onNudge: () => void;
  readonly onGone: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = button.current;
    // As the button goes, if it had focus, hand focus to the list rather
    // than let it fall to the page. onGone is stable: this runs once.
    return () => {
      if (element !== null && element === document.activeElement) onGone();
    };
  }, [onGone]);
  return (
    <button
      ref={button}
      type="button"
      className={sent ? "person-nudge person-nudge--sent" : "person-nudge"}
      aria-disabled={sent || !live ? true : undefined}
      onClick={() => {
        if (!sent && live) onNudge();
      }}
    >
      {sent ? NUDGE_COPY.nudged : NUDGE_COPY.nudge}
      <span className="visually-hidden"> {name}</span>
    </button>
  );
}

/**
 * After reveal: the name, then a neutral chip with the card. Without a
 * vote, a pill says so in words, the same to the eye and the ear: "Away"
 * for someone away, "No vote" in the Not yet colours for someone here.
 * Colour stays on the scale.
 */
function RevealedPerson({
  person,
  you,
}: {
  readonly person: RevealedParticipantView;
  readonly you: boolean;
}) {
  const card = person.vote;
  return (
    <li className="person">
      <span className="person-name">{person.name}</span>
      {you && (
        <>
          {" "}
          <span className="person-you">{PEOPLE_COPY.you}</span>
        </>
      )}{" "}
      {card !== null ? (
        <span className="chip">
          <CardText card={card} />
        </span>
      ) : person.status === "disconnected" ? (
        <span className="pill pill--away">{PEOPLE_COPY.away}</span>
      ) : (
        <span className="pill pill--not-yet">{PEOPLE_COPY.noVote}</span>
      )}
    </li>
  );
}
