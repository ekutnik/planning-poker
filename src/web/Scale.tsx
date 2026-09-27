import { DECK, type Card } from "../shared/deck.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { CardText } from "./CardText.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/**
 * The deck is the scale (docs/design.md): after reveal, the same row of cards
 * shows each name above the card it chose, numeric or not. Consensus stacks
 * everyone on one card; a wide spread stretches across the deck. Cards
 * nobody chose stay in place, so the distance between votes stays visible.
 * The winning card, and its names, are tinted Win; the cards of a draw,
 * Draw. The server decides which win (results.winners).
 *
 * In the DOM each step is the card, then its names in join order, so a
 * screen reader hears "5: Ben, Dee"; CSS draws the names above the card,
 * the first to join nearest it.
 */
export function Scale({ snapshot }: { readonly snapshot: Revealed }) {
  const { participants, results } = snapshot;
  const winners: ReadonlySet<Card> = new Set(results.winners);
  const highlight = results.winners.length > 1 ? "draw" : "win";
  const stepClass = (card: Card, voters: number) =>
    voters === 0
      ? "scale-step scale-step--empty"
      : winners.has(card)
        ? `scale-step scale-step--${highlight}`
        : "scale-step";

  return (
    <ol className="scale" aria-label="Votes on the deck">
      {DECK.map((card) => {
        const voters = participants.filter((p) => p.vote === card);
        return (
          <li key={card} className={stepClass(card, voters.length)}>
            <span className="scale-card">
              <CardText card={card} />
            </span>
            {voters.length > 0 && (
              <ul className="scale-names">
                {voters.map((p) => (
                  <li key={p.id} className="scale-name">
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
