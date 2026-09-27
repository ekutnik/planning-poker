import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VotingParticipantView } from "../shared/snapshot.js";
import { People, personStatus } from "./People.js";

const person = (
  status: "connected" | "disconnected",
  hasVoted: boolean,
): VotingParticipantView => ({ id: "x", name: "Cy", status, hasVoted });

describe("personStatus", () => {
  it.each([
    ["connected", true, "voted"],
    ["connected", false, "not-yet"],
    ["disconnected", false, "away"],
    // Away with a vote still counts, as the status line counts them.
    ["disconnected", true, "voted"],
  ] as const)("%s, voted %s: %s", (status, hasVoted, expected) => {
    expect(personStatus(person(status, hasVoted))).toBe(expected);
  });
});

describe("the people list while voting", () => {
  const html = renderToStaticMarkup(
    <People
      viewerId="me"
      participants={[
        { id: "b", name: "Ben", status: "connected", hasVoted: true },
        { id: "me", name: "Ada", status: "connected", hasVoted: false },
        { id: "f", name: "Fay", status: "disconnected", hasVoted: false },
      ]}
    />,
  );

  it("gives each person a row: the name, then a pill in words", () => {
    expect(html).toBe(
      '<ul class="people" aria-label="Participants">' +
        '<li class="person"><span class="person-name">Ben</span><span class="pill pill--voted">Voted</span></li>' +
        '<li class="person"><span class="person-name">Ada</span> <span class="person-you">(you)</span><span class="pill pill--not-yet">Not yet</span></li>' +
        '<li class="person"><span class="person-name">Fay</span><span class="pill pill--away">Away</span></li>' +
        "</ul>",
    );
  });

  it("marks only the viewer's own row, and keeps join order", () => {
    expect(html.match(/\(you\)/g)).toHaveLength(1);
    expect(html.indexOf("Ben")).toBeLessThan(html.indexOf("Ada"));
  });

  it('keeps "(you)" out of the name, so a long name is never cut there', () => {
    // .person-name is the part that shrinks with "…".
    expect(html).not.toMatch(/<span class="person-name">[^<]*<span/);
    expect(html).toMatch(/<\/span> <span class="person-you">\(you\)<\/span>/);
  });
});
