import { describe, expect, it } from "vitest";
import { hiddenCount, panelStillOpen, STACK_CAP } from "./stack.js";

describe("a card's name stack (stack.ts)", () => {
  it("shows five names, and hides the rest behind +n more", () => {
    expect(STACK_CAP).toBe(5);
    expect(hiddenCount(0)).toBe(0);
    expect(hiddenCount(5)).toBe(0);
    expect(hiddenCount(6)).toBe(1);
    expect(hiddenCount(12)).toBe(7);
  });
});

describe("an open +n more panel", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `p${String(i)}`);

  it("stays open while everyone it showed is still on the card", () => {
    expect(panelStillOpen(twelve, twelve)).toBe(true);
  });

  it("stays open when someone arrives on the card: they join the list", () => {
    expect(panelStillOpen(twelve, [...twelve, "late"])).toBe(true);
  });

  it("closes when someone it showed leaves the card, by leaving or by a moved vote", () => {
    expect(panelStillOpen(twelve, twelve.slice(1))).toBe(false);
    expect(panelStillOpen(twelve, [...twelve.slice(0, 11), "other"])).toBe(
      false,
    );
  });

  it("closes when the card no longer needs +n more", () => {
    const six = twelve.slice(0, 6);
    expect(panelStillOpen(six, six)).toBe(true);
    expect(panelStillOpen(twelve.slice(0, 5), twelve.slice(0, 5))).toBe(false);
  });
});
