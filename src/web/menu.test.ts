import { describe, expect, it } from "vitest";
import { menuTransition } from "./menu.js";

describe("the header's Menu, a disclosure", () => {
  it("opens and closes with its button, without moving focus", () => {
    expect(menuTransition(false, "toggle")).toEqual({
      open: true,
      focusButton: false,
    });
    expect(menuTransition(true, "toggle")).toEqual({
      open: false,
      focusButton: false,
    });
  });

  it("closes on Escape and returns focus to the button", () => {
    expect(menuTransition(true, "escape")).toEqual({
      open: false,
      focusButton: true,
    });
  });

  it("leaves focus alone on Escape when it was already closed", () => {
    expect(menuTransition(false, "escape")).toEqual({
      open: false,
      focusButton: false,
    });
  });

  it.each(["click-outside", "focus-left"] as const)(
    "closes on %s, leaving focus where the person put it",
    (event) => {
      expect(menuTransition(true, event)).toEqual({
        open: false,
        focusButton: false,
      });
    },
  );
});
