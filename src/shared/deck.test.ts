import { describe, expect, it } from "vitest";
import { DECK, NUMERIC_CARDS, isNumericCard } from "./deck.js";

describe("deck", () => {
  it("orders numeric cards strictly ascending, so deck position can measure spread", () => {
    const values = NUMERIC_CARDS.map(Number);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it("classifies ? and ☕ as non-numeric", () => {
    expect(isNumericCard("?")).toBe(false);
    expect(isNumericCard("☕")).toBe(false);
  });

  it("classifies every numeric card as numeric", () => {
    for (const card of NUMERIC_CARDS) expect(isNumericCard(card)).toBe(true);
  });

  it("contains no duplicate cards", () => {
    expect(new Set(DECK).size).toBe(DECK.length);
  });
});
