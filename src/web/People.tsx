import type {
  RevealedParticipantView,
  VotingParticipantView,
} from "../shared/snapshot.js";
import { CardText } from "./CardText.js";

/**
 * Everyone in the room, in join order. Before reveal a filled dot says who
 * has voted; after reveal each person's card sits next to their name
 * ("● Ada 3"), so everyone can read their own row. "Away" is a word.
 */
export function People({
  participants,
}: {
  readonly participants: readonly (
    VotingParticipantView | RevealedParticipantView
  )[];
}) {
  return (
    <ul className="people" aria-label="Participants">
      {participants.map((p) => {
        // undefined before reveal, when nobody's card is known.
        const card = "vote" in p ? p.vote : undefined;
        const voted = "vote" in p ? p.vote !== null : p.hasVoted;
        return (
          <li key={p.id}>
            <span className="dot" aria-hidden="true">
              {voted ? "●" : "○"}
            </span>
            {p.name}
            {card === undefined ? (
              <span className="visually-hidden">
                , {voted ? "voted" : "not voted"}
              </span>
            ) : card === null ? (
              <span className="visually-hidden">, no vote</span>
            ) : (
              <>
                {" "}
                <span className="person-card">
                  <CardText card={card} />
                </span>
              </>
            )}
            {p.status === "disconnected" && " (away)"}
          </li>
        );
      })}
    </ul>
  );
}
