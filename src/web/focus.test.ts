import { describe, expect, it } from "vitest";
import { shouldRecoverFocus } from "./focus.js";

describe("shouldRecoverFocus (A-02)", () => {
  const body = { id: "body" } as unknown as Element;
  const button = { id: "button" } as unknown as Element;

  it("takes focus when it fell to the page after something had it", () => {
    expect(shouldRecoverFocus(true, body, body)).toBe(true);
    expect(shouldRecoverFocus(true, null, body)).toBe(true);
  });

  it("leaves a fresh page load to the browser", () => {
    expect(shouldRecoverFocus(false, body, body)).toBe(false);
  });

  it("never moves focus that is still on something", () => {
    expect(shouldRecoverFocus(true, button, body)).toBe(false);
  });
});
