import { describe, expect, it } from "vitest";
import { CloseCode } from "./close-codes.js";

describe("CloseCode", () => {
  const codes = Object.values(CloseCode);

  it("uses only the application range RFC 6455 reserves (4000–4999)", () => {
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThanOrEqual(4999);
    }
  });

  it("gives every close reason its own code", () => {
    expect(new Set(codes).size).toBe(codes.length);
  });
});
