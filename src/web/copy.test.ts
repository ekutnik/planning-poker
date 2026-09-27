import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from "../shared/rules.js";
import {
  COPY_LINK_COPY,
  ERROR_COPY,
  HEADER_COPY,
  HOME_COPY,
  JOIN_COPY,
  NOT_FOUND_COPY,
  NOT_SAVED_COPY,
  PEOPLE_COPY,
  STOP_ACTION_LABELS,
  STOP_COPY,
} from "./copy.js";

/** Every full sentence the app shows outside the round's own lines. */
const sentences = [
  ...Object.values(ERROR_COPY).filter((copy) => copy !== null),
  ...Object.values(STOP_COPY).flatMap(({ title, body }) => [title, body]),
  HOME_COPY.intro,
  HOME_COPY.invite,
  HOME_COPY.failed,
  JOIN_COPY.intro,
  NOT_FOUND_COPY.title,
  NOT_FOUND_COPY.body,
  NOT_SAVED_COPY,
  HEADER_COPY.facilitateNote,
  COPY_LINK_COPY.failed,
];

/** Headings and button labels: short, no full stop. */
const labels = [
  HOME_COPY.heading,
  HOME_COPY.submit,
  JOIN_COPY.heading,
  JOIN_COPY.submit,
  NOT_FOUND_COPY.action,
  ...Object.values(STOP_ACTION_LABELS),
  HEADER_COPY.menu,
  HEADER_COPY.facilitate,
  HEADER_COPY.facilitating,
  HEADER_COPY.theme,
  HEADER_COPY.leave,
  COPY_LINK_COPY.copy,
  COPY_LINK_COPY.copied,
  // Pills and the own-vote button: "Voted", "No vote", "Clear my vote", …
  ...Object.values(PEOPLE_COPY),
];

const everything = [...sentences, ...labels];

describe("copy", () => {
  it("says what happened and what to do, without apologising", () => {
    for (const copy of everything) {
      expect(copy).not.toMatch(/sorry|oops|unfortunately|apolog/i);
    }
  });

  it("ends sentences with a full stop, and labels without one", () => {
    for (const copy of sentences) expect(copy).toMatch(/\.$/);
    for (const copy of labels) expect(copy).not.toMatch(/\.$/);
  });

  it("uses the words on the buttons, one name per action", () => {
    for (const copy of everything) {
      expect(copy).not.toMatch(/\bgame\b/i); // it is a room
      expect(copy).not.toMatch(/new round/i); // "Start next round"
      expect(copy).not.toMatch(/\bpick\b/i); // you choose a card
      expect(copy).not.toMatch(/start a room/i); // "Create a room"
      expect(copy).not.toMatch(/everyone reveals/i); // anyone can reveal
    }
    expect(NOT_FOUND_COPY.action).toBe(HOME_COPY.submit);
  });

  it("uses contractions, as the rest of the app does", () => {
    for (const copy of everything) {
      expect(copy).not.toMatch(
        /\b(could|is|are|was|were|do|does|did|has|have|can) not\b|\bcannot\b/i,
      );
    }
  });

  it("states the real limits, from the shared rules", () => {
    expect(STOP_COPY["room-full"].body).toContain(String(MAX_PARTICIPANTS));
    expect(STOP_COPY["invalid-name"].title).toContain(String(MAX_NAME_LENGTH));
  });
});
