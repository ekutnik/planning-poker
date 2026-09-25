import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from "../shared/rules.js";
import { ERROR_COPY, STOP_COPY } from "./copy.js";

describe("copy", () => {
  const all = [
    ...Object.values(ERROR_COPY).filter((copy) => copy !== null),
    ...Object.values(STOP_COPY).flatMap(({ title, body }) => [title, body]),
  ];

  it("says what happened and what to do, without apologising", () => {
    for (const copy of all) {
      expect(copy).not.toMatch(/sorry|oops|unfortunately|apolog/i);
      expect(copy).toMatch(/\.$/);
    }
  });

  it("states the real limits, from the shared rules", () => {
    expect(STOP_COPY["room-full"].title).toContain(String(MAX_PARTICIPANTS));
    expect(STOP_COPY["invalid-name"].title).toContain(String(MAX_NAME_LENGTH));
  });
});
