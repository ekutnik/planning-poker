import { describe, expect, it } from "vitest";
import { SESSION_TOKEN_PATTERN } from "../shared/rules.js";
import { loadIdentity, newToken, type KeyValueStore } from "./identity.js";

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const tokens = (...values: string[]) => {
  const queue = [...values];
  return () => queue.shift() ?? "unexpected-extra-token-0000";
};
const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

describe("loadIdentity", () => {
  it("creates a token on first visit and reuses it afterwards", () => {
    const store = new MemoryStore();
    const first = loadIdentity(() => store, tokens(TOKEN_A));
    const second = loadIdentity(() => store, tokens(TOKEN_B));
    expect(first.sessionToken).toBe(TOKEN_A);
    expect(first.persistent).toBe(true);
    expect(second.sessionToken).toBe(TOKEN_A);
  });

  it("replaces a malformed stored token instead of trusting it", () => {
    const store = new MemoryStore();
    store.setItem("planning-poker:token", "not a token!");
    const identity = loadIdentity(() => store, tokens(TOKEN_A));
    expect(identity.sessionToken).toBe(TOKEN_A);
    expect(store.getItem("planning-poker:token")).toBe(TOKEN_A);
  });

  it("falls back to memory when localStorage cannot even be accessed", () => {
    const identity = loadIdentity(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    }, tokens(TOKEN_A));
    expect(identity.sessionToken).toBe(TOKEN_A);
    expect(identity.persistent).toBe(false);
    identity.rememberName("Ada");
    expect(identity.lastName()).toBe("Ada");
  });

  it("falls back to memory when writing throws", () => {
    const store = new MemoryStore();
    store.setItem = () => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    const identity = loadIdentity(() => store, tokens(TOKEN_A));
    expect(identity.sessionToken).toBe(TOKEN_A);
    expect(identity.persistent).toBe(false);
    identity.rememberName("Ada");
    expect(identity.lastName()).toBe("Ada");
  });

  it("returns a stored name only if it is still valid, normalised", () => {
    const store = new MemoryStore();
    store.setItem("planning-poker:name", "  Ada   Lovelace ");
    expect(loadIdentity(() => store, tokens(TOKEN_A)).lastName()).toBe(
      "Ada Lovelace",
    );
    store.setItem("planning-poker:name", "x".repeat(99));
    expect(loadIdentity(() => store, tokens(TOKEN_A)).lastName()).toBeNull();
  });
});

describe("newToken", () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);

  it("uses randomUUID where it exists", () => {
    expect(newToken({ randomUUID: () => TOKEN_B, getRandomValues })).toBe(
      TOKEN_B,
    );
  });

  it("falls back to getRandomValues outside a secure context", () => {
    const token = newToken({ getRandomValues });
    expect(token).toMatch(SESSION_TOKEN_PATTERN);
    expect(token).toHaveLength(22);
  });
});
