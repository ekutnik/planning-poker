import { useId, useState } from "react";
import { DECK, type Card } from "../shared/deck.js";
import type { ParticipantId } from "../shared/ids.js";
import type {
  RevealedParticipantView,
  RoomSnapshot,
} from "../shared/snapshot.js";
import { CardText } from "./CardText.js";
import { STACK_COPY } from "./copy.js";
import { useDisclosure } from "./disclosure.js";
import { spokenCard } from "./result.js";
import { hiddenCount, panelStillOpen, STACK_CAP } from "./stack.js";

type Revealed = Extract<RoomSnapshot, { phase: "revealed" }>;

/** The open "+n more" panel: its card, and whom it showed when it opened. */
interface OpenPanel {
  readonly card: Card;
  readonly shown: readonly ParticipantId[];
}

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
 * the first to join nearest it. Cards nobody chose are hidden from screen
 * readers (#44, heard with VoiceOver): on screen the gaps show the spread,
 * but read aloud they are only a list of numbers between the votes.
 *
 * In wide, a stack shows five names, then "+n more" (stack.ts): the names
 * past five stay in the list for a screen reader, hidden on screen, and the
 * button opens a panel with all of them. One panel is open at a time.
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
  const votersOf = (card: Card) => participants.filter((p) => p.vote === card);

  // The room changed shape under an open panel: close it, rather than show
  // a list that is no longer true (React's "adjust state when a prop
  // changes" pattern).
  const [open, setOpen] = useState<OpenPanel | null>(null);
  if (
    open !== null &&
    !panelStillOpen(
      open.shown,
      votersOf(open.card).map((p) => p.id),
    )
  ) {
    setOpen(null);
  }

  return (
    <ol className="scale" aria-label="Votes on the deck">
      {DECK.map((card) => {
        const voters = votersOf(card);
        return (
          <li
            key={card}
            className={stepClass(card, voters.length)}
            aria-hidden={voters.length === 0 ? true : undefined}
          >
            <span className="scale-card">
              <CardText card={card} />
            </span>
            {voters.length > 0 && (
              <ul className="scale-names">
                {voters.map((p, index) => (
                  <li
                    key={p.id}
                    className={
                      index < STACK_CAP
                        ? "scale-name"
                        : "scale-name scale-name--over"
                    }
                    dir="auto"
                  >
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
            {hiddenCount(voters.length) > 0 && (
              <MoreNames
                card={card}
                voters={voters}
                open={open?.card === card}
                onOpenChange={(next) =>
                  setOpen((current) =>
                    next
                      ? { card, shown: voters.map((p) => p.id) }
                      : current?.card === card
                        ? null
                        : current,
                  )
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * "+7 more" and its panel: everyone on the card, in join order, in two
 * columns, under the line "12 chose 5". It opens and closes as the Menu
 * does (disclosure.ts), over the cards, so nothing moves. Its name starts
 * with its words and says what it shows, "+7 more: show all 12 who chose
 * 5"; the list before it already holds every name, so a screen reader loses
 * nothing while it is closed.
 */
function MoreNames({
  card,
  voters,
  open,
  onOpenChange,
}: {
  readonly card: Card;
  readonly voters: readonly RevealedParticipantView[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const panelId = `${useId()}-names`;
  const { wrapper, button, toggle, onBlur } = useDisclosure(open, onOpenChange);
  return (
    <div ref={wrapper} className="scale-more" onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="small-button scale-more-button"
        aria-label={STACK_COPY.name(
          hiddenCount(voters.length),
          voters.length,
          spokenCard(card),
        )}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {STACK_COPY.more(hiddenCount(voters.length))}
      </button>
      <div id={panelId} className="scale-more-panel" hidden={!open}>
        <p className="scale-more-title">
          {STACK_COPY.chose(voters.length)} <CardText card={card} />
        </p>
        <ul className="scale-more-names">
          {voters.map((p) => (
            <li key={p.id} dir="auto">
              {p.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
