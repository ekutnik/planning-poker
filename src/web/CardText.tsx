import type { Card } from "../shared/deck.js";
import { spokenCard } from "./result.js";

/** A card as text: the symbol on screen, words for a screen reader. */
export function CardText({ card }: { readonly card: Card }) {
  const spoken = spokenCard(card);
  if (spoken === card) return <>{card}</>;
  return (
    <>
      <span aria-hidden="true">{card}</span>
      <span className="visually-hidden">{spoken}</span>
    </>
  );
}
