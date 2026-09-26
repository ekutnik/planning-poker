import { describe, expect, it } from "vitest";
import { DECK } from "../shared/deck.js";
import { moveFocus, tabStop } from "./deck-keys.js";
import { createFacilitateStore, FACILITATE_KEY } from "./facilitate.js";
import type { KeyValueStore } from "./storage.js";

describe("moveFocus", () => {
  it.each([
    ["ArrowRight", 0, 1],
    ["ArrowDown", 0, 1],
    ["ArrowRight", 9, 0],
    ["ArrowLeft", 0, 9],
    ["ArrowUp", 3, 2],
    ["Home", 6, 0],
    ["End", 2, 9],
  ])("%s from %i goes to %i", (key, from, to) => {
    expect(moveFocus(from, key, DECK.length)).toBe(to);
  });

  it("leaves Space, Enter and letters to the caller", () => {
    for (const key of [" ", "Enter", "a", "Tab"]) {
      expect(moveFocus(0, key, DECK.length)).toBeNull();
    }
  });
});

describe("tabStop", () => {
  it("is the chosen card when the vote is shown, the first card otherwise", () => {
    expect(tabStop(DECK, "13")).toBe(DECK.indexOf("13"));
    expect(tabStop(DECK, null)).toBe(0);
  });
});

describe("createFacilitateStore", () => {
  it("is off by default, and remembers being turned on", () => {
    const data = new Map<string, string>();
    const storage: KeyValueStore = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
    const store = createFacilitateStore(() => storage);
    expect(store.isOn()).toBe(false);

    let calls = 0;
    store.subscribe(() => (calls += 1));
    store.set(true);
    store.set(true);
    expect(calls).toBe(1);
    expect(data.get(FACILITATE_KEY)).toBe("on");
    expect(createFacilitateStore(() => storage).isOn()).toBe(true);
  });
});
