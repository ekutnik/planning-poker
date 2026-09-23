export const DECK = [
  "0",
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "21",
  "?",
  "☕",
] as const;
export type Card = (typeof DECK)[number];

export const NUMERIC_CARDS = [
  "0",
  "1",
  "2",
  "3",
  "5",
  "8",
  "13",
  "21",
] as const satisfies readonly Card[];
export type NumericCard = (typeof NUMERIC_CARDS)[number];

export function isNumericCard(card: Card): card is NumericCard {
  return (NUMERIC_CARDS as readonly Card[]).includes(card);
}
