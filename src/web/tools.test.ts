import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "./storage.js";
import { createToolsStore, parseTools, TOOLS_KEY } from "./tools.js";

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("the Session tools a browser keeps (Ticket and Timer)", () => {
  it("are off in a browser that has never set them", () => {
    const store = createToolsStore(() => new MemoryStore());
    expect(store.get()).toEqual({ ticket: false, timer: false });
  });

  it("are stored under planning-poker:tools:v1, and read back by the next visit", () => {
    const memory = new MemoryStore();
    const store = createToolsStore(() => memory);
    store.set("ticket", true);
    expect([...memory.data.keys()]).toEqual([TOOLS_KEY]);
    expect(TOOLS_KEY).toBe("planning-poker:tools:v1");
    expect(createToolsStore(() => memory).get()).toEqual({
      ticket: true,
      timer: false,
    });
    store.set("timer", true);
    store.set("ticket", false);
    expect(createToolsStore(() => memory).get()).toEqual({
      ticket: false,
      timer: true,
    });
  });

  it("tells subscribers about a change, and keeps the same object otherwise", () => {
    const store = createToolsStore(() => new MemoryStore());
    const seen: boolean[] = [];
    const stop = store.subscribe(() => seen.push(store.get().timer));
    const before = store.get();
    store.set("timer", false); // already off: nothing happens
    expect(store.get()).toBe(before);
    store.set("timer", true);
    expect(seen).toEqual([true]);
    stop();
    store.set("timer", false);
    expect(seen).toEqual([true]);
  });

  it("treats anything but true as off, so a damaged value turns nothing on", () => {
    for (const stored of [
      null,
      "",
      "on",
      "null",
      "[true]",
      '{"ticket":"true","timer":1}',
    ]) {
      expect(parseTools(stored)).toEqual({ ticket: false, timer: false });
    }
    expect(parseTools('{"timer":true,"later":true}')).toEqual({
      ticket: false,
      timer: true,
    });
  });

  it("works without storage, for this visit only", () => {
    const store = createToolsStore(() => {
      throw new Error("blocked");
    });
    store.set("ticket", true);
    expect(store.get().ticket).toBe(true);
  });
});
