import { describe, expect, it } from "vitest";
import { parseClientMessage } from "./protocol.js";

const TOKEN = "abcdef_ghijklmnopqrstuv-1234"; // 28 url-safe chars

describe("parseClientMessage — valid messages", () => {
  it.each([
    { type: "join", sessionToken: TOKEN, name: "Alice" },
    { type: "castVote", card: "5" },
    { type: "castVote", card: "☕" },
    { type: "clearVote" },
    { type: "reveal" },
    { type: "reset" },
    { type: "leave" },
  ])("accepts $type", (message) => {
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  });
});

describe("parseClientMessage — rejections", () => {
  it("rejects an unknown message type", () => {
    expect(parseClientMessage(JSON.stringify({ type: "nuke" }))).toBeNull();
  });

  it("rejects an extra key (strictObject, not strip)", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "reveal", extra: 1 })),
    ).toBeNull();
  });

  it("rejects an invalid card", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "castVote", card: "7" })),
    ).toBeNull();
  });

  it("rejects non-JSON without throwing", () => {
    expect(parseClientMessage("not json {")).toBeNull();
  });

  it("rejects an over-long name (201 chars)", () => {
    const message = {
      type: "join",
      sessionToken: TOKEN,
      name: "x".repeat(201),
    };
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });

  it("rejects a malformed session token", () => {
    const message = { type: "join", sessionToken: "too-short", name: "Alice" };
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });

  it("rejects a forged actor smuggled into castVote", () => {
    // The socket is the identity after join; a participantId on the wire is an
    // impersonation attempt and must be rejected, not silently ignored.
    const attack = { type: "castVote", card: "5", participantId: "bob" };
    expect(parseClientMessage(JSON.stringify(attack))).toBeNull();
  });

  it("rejects a prototype-pollution probe", () => {
    // JSON.parse creates __proto__ as an own key, so strictObject rejects it.
    const probe = '{"type":"reveal","__proto__":{"polluted":true}}';
    expect(parseClientMessage(probe)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
