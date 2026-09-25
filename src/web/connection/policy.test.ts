import { describe, expect, it } from "vitest";
import { CloseCode } from "../../shared/close-codes.js";
import {
  BACKOFF,
  backoffDelay,
  policyFor,
  type ClosePolicy,
} from "./policy.js";

describe("policyFor (#20)", () => {
  it.each<[string, number, ClosePolicy]>([
    ["the server ended the session", 1000, { kind: "stop", reason: "left" }],
    [
      "SUPERSEDED",
      CloseCode.SUPERSEDED,
      { kind: "stop", reason: "superseded" },
    ],
    [
      "OUTDATED_CLIENT",
      CloseCode.OUTDATED_CLIENT,
      { kind: "stop", reason: "outdated" },
    ],
    [
      "JOIN_TIMEOUT",
      CloseCode.JOIN_TIMEOUT,
      { kind: "retry", backoff: "normal" },
    ],
    ["going away (restart)", 1001, { kind: "retry", backoff: "normal" }],
    ["abnormal closure", 1006, { kind: "retry", backoff: "normal" }],
    ["policy violation", 1008, { kind: "retry", backoff: "long" }],
    ["try again later", 1013, { kind: "retry", backoff: "long" }],
    ["an unknown code", 4999, { kind: "retry", backoff: "normal" }],
    ["no status (1005)", 1005, { kind: "retry", backoff: "normal" }],
  ])("%s (%i)", (_name, code, policy) => {
    expect(policyFor(code)).toEqual(policy);
  });
});

describe("backoffDelay", () => {
  const almostOne = () => 0.999_999;

  it("doubles its window per attempt until the cap", () => {
    const windows = [0, 1, 2, 3, 4, 5, 6, 10].map((attempt) =>
      backoffDelay(attempt, almostOne),
    );
    expect(windows).toEqual([499, 999, 1999, 3999, 7999, 9999, 9999, 9999]);
  });

  it("is full jitter: anywhere from zero to the window", () => {
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
  });

  it("uses a much larger window for the long backoff", () => {
    const { baseMs, capMs } = BACKOFF.long;
    expect(backoffDelay(0, almostOne, baseMs, capMs)).toBeGreaterThan(
      backoffDelay(0, almostOne),
    );
    expect(backoffDelay(20, almostOne, baseMs, capMs)).toBe(capMs - 1);
  });
});
