import { useRef, useState, type KeyboardEvent } from "react";
import { DECK, type Card } from "../shared/deck.js";
import { moveFocus, tabStop } from "./deck-keys.js";

/**
 * The deck as a toolbar of toggle buttons: one Tab stop, arrow keys move
 * focus without voting, Space or Enter votes (they are the buttons' own
 * keys). Not a radiogroup: that pattern selects on arrow keys, which here
 * would cast and broadcast a vote on every keypress. `shown` is the card to
 * show as chosen; pass null when the vote is hidden, and the deck renders
 * identically whatever the vote.
 */
export function Deck({
  shown,
  disabled,
  onChoose,
}: {
  readonly shown: Card | null;
  readonly disabled: boolean;
  readonly onChoose: (card: Card) => void;
}) {
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  // Where focus is while the keyboard moves through the deck; null otherwise,
  // so the Tab stop returns to tabStop() once focus leaves.
  const [active, setActive] = useState<number | null>(null);
  const stop = active ?? tabStop(DECK, shown);

  const onKeyDown = (event: KeyboardEvent) => {
    const next = moveFocus(stop, event.key, DECK.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    cards.current[next]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label="Your card"
      className="deck"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(null);
      }}
    >
      {DECK.map((card, index) => (
        <button
          key={card}
          ref={(element) => {
            cards.current[index] = element;
          }}
          type="button"
          className="card"
          aria-pressed={card === shown}
          tabIndex={index === stop ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            setActive(index);
            onChoose(card);
          }}
        >
          {card}
        </button>
      ))}
    </div>
  );
}
