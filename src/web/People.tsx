import type {
  RevealedParticipantView,
  VotingParticipantView,
} from "../shared/snapshot.js";
import { CardText } from "./CardText.js";
import { PEOPLE_COPY } from "./copy.js";

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
 * card sits next to their name, so everyone can read their own row.
 */
export function People({
  participants,
  viewerId,
}: {
  readonly participants: readonly (
    VotingParticipantView | RevealedParticipantView
  )[];
  readonly viewerId: string;
}) {
  const revealed = participants.some((p) => "vote" in p);
  return (
    <ul
      className={revealed ? "people people--revealed" : "people"}
      aria-label="Participants"
    >
      {participants.map((p) =>
        "vote" in p ? (
          <RevealedPerson key={p.id} person={p} />
        ) : (
          <li key={p.id} className="person">
            <span className="person-name">
              {p.name}
              {p.id === viewerId && (
                <span className="person-you"> {PEOPLE_COPY.you}</span>
              )}
            </span>
            <span className={`pill pill--${personStatus(p)}`}>
              {STATUS_LABEL[personStatus(p)]}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}

/** Until PR 4 of 7b moves the revealed list below the scale, with chips. */
function RevealedPerson({
  person,
}: {
  readonly person: RevealedParticipantView;
}) {
  const card = person.vote;
  return (
    <li>
      <span className="dot" aria-hidden="true">
        {card !== null ? "●" : "○"}
      </span>
      {person.name}
      {card === null ? (
        <span className="visually-hidden">, no vote</span>
      ) : (
        <>
          {" "}
          <span className="person-card">
            <CardText card={card} />
          </span>
        </>
      )}
      {person.status === "disconnected" && " (away)"}
    </li>
  );
}
