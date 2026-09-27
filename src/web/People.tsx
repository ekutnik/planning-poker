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
 * card sits next to their name in a neutral chip.
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
          <RevealedPerson key={p.id} person={p} you={p.id === viewerId} />
        ) : (
          <li key={p.id} className="person">
            {/* "(you)" sits outside the name, so shortening a long name
                never cuts it: it is what tells you which row is yours. The
                space between them is for a screen reader; flex drops it. */}
            <span className="person-name">{p.name}</span>
            {p.id === viewerId && (
              <>
                {" "}
                <span className="person-you">{PEOPLE_COPY.you}</span>
              </>
            )}
            <span className={`pill pill--${personStatus(p)}`}>
              {STATUS_LABEL[personStatus(p)]}
            </span>
          </li>
        ),
      )}
    </ul>
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
