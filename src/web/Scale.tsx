import { DECK } from "../shared/deck.js";
import type {
  RevealedParticipantView,
  RoomSnapshot,
} from "../shared/snapshot.js";
import { CardText } from "./CardText.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/**
 * The deck is the scale (docs/design.md): after reveal, the same row of cards
 * shows each name above the card it chose, numeric or not. Consensus stacks
 * everyone on one card; a wide spread stretches across the deck. Cards
 * nobody chose stay in place, so the distance between votes stays visible.
 *
 * In the DOM each step is the card, then its names in join order, so a
 * screen reader hears "5: Ben, Dee"; CSS draws the names above the card,
 * the first to join nearest it.
 */
export function Scale({ snapshot }: { readonly snapshot: Revealed }) {
  const { participants, results } = snapshot;
  const outliers = new Set(results.outliers);
  const nameClass = (p: RevealedParticipantView) =>
    results.consensus
      ? "scale-name scale-name--agree"
      : outliers.has(p.id)
        ? "scale-name scale-name--discuss"
        : "scale-name";

  return (
    <ol className="scale" aria-label="Votes on the deck">
      {DECK.map((card) => {
        const voters = participants.filter((p) => p.vote === card);
        return (
          <li
            key={card}
            className={
              voters.length === 0
                ? "scale-step scale-step--empty"
                : "scale-step"
            }
          >
            <span className="scale-card">
              <CardText card={card} />
            </span>
            {voters.length > 0 && (
              <ul className="scale-names">
                {voters.map((p) => (
                  <li key={p.id} className={nameClass(p)}>
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
