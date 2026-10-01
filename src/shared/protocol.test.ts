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
    { type: "ping" },
    { type: "nudge", participantId: "AbCdEfGh_-123456" },
  ])("accepts $type", (message) => {
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  });
});

describe("parseClientMessage — setTicket", () => {
  it("accepts text up to 200 raw characters, the payload cap", () => {
    for (const text of ["", "PROJ-482", "x".repeat(200)]) {
      const message = { type: "setTicket", text };
      expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
    }
  });

  it.each([
    ["201 characters", { type: "setTicket", text: "x".repeat(201) }],
    ["no text", { type: "setTicket" }],
    ["text that is not a string", { type: "setTicket", text: 482 }],
    ["an extra key", { type: "setTicket", text: "PROJ-1", roomId: "x" }],
  ])("rejects %s", (_, message) => {
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });
});

describe("parseClientMessage — setScoring", () => {
  it.each([true, false])("accepts on: %s", (on) => {
    const message = { type: "setScoring", on };
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  });

  it.each([
    ["no value", { type: "setScoring" }],
    ["a value that is not a boolean", { type: "setScoring", on: "yes" }],
    ["an extra key", { type: "setScoring", on: true, points: 5 }],
  ])("rejects %s", (_, message) => {
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });
});

describe("parseClientMessage — the timer", () => {
  it.each([
    { type: "timerSetDuration", ms: 60_000 },
    { type: "timerStart" },
    { type: "timerPause" },
    { type: "timerResume" },
    { type: "timerAdd" },
  ])("accepts $type", (message) => {
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  });

  it.each([
    ["a duration as a string", { type: "timerSetDuration", ms: "60000" }],
    ["a fraction of a millisecond", { type: "timerSetDuration", ms: 1.5 }],
    ["a negative duration", { type: "timerSetDuration", ms: -1 }],
    ["more than an hour", { type: "timerSetDuration", ms: 3_600_001 }],
    [
      "an amount on +30 s: the server decides it",
      { type: "timerAdd", ms: 600_000 },
    ],
    ["a deadline from the client", { type: "timerStart", endsAt: 1 }],
  ])("rejects %s", (_, message) => {
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
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

  it.each([
    ["no target", { type: "nudge" }],
    [
      "a target that is not a public id",
      { type: "nudge", participantId: "Cy" },
    ],
    // The sender is the socket; a message cannot claim to be from someone.
    [
      "a sender",
      {
        type: "nudge",
        participantId: "AbCdEfGh_-123456",
        from: "AbCdEfGh_-654321",
      },
    ],
  ])("rejects a nudge with %s", (_, message) => {
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });

  it("rejects a ping that carries anything", () => {
    expect(
      parseClientMessage(JSON.stringify({ type: "ping", at: 1 })),
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
