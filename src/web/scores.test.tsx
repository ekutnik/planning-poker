import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  RevealedParticipantView,
  Scores,
  VotingParticipantView,
} from "../shared/snapshot.js";
import type { FacilitateStore } from "./facilitate.js";
import { Header } from "./Header.js";
import { People } from "./People.js";
import { byPoints } from "./scores.js";
import type { ThemeStore } from "./theme.js";

/**
 * Keep score in the browser: the order by points, each row's points, and
 * the switch in the Menu. The rules for awarding points are the server's
 * (room.test.ts, "keeping score").
 */

const voting = (id: string): VotingParticipantView => ({
  id,
  name: id,
  status: "connected",
  hasVoted: true,
});
const revealed = (id: string): RevealedParticipantView => ({
  id,
  name: id,
  status: "connected",
  vote: "5",
});
const JOIN_ORDER = ["Ada", "Ben", "Cy", "Dee"];

describe("byPoints", () => {
  const people = JOIN_ORDER.map(voting);

  it("keeps join order while scoring is off: the very same array", () => {
    expect(byPoints(people, null)).toBe(people);
  });

  it("puts the most points first, ties in join order, 0 for someone missing", () => {
    const scores: Scores = { Ada: 1, Ben: 3, Cy: 1 };
    expect(byPoints(people, scores).map((p) => p.id)).toEqual([
      "Ben",
      "Ada",
      "Cy",
      "Dee",
    ]);
  });
});

const renderPeople = (scores: Scores | null, phase: "voting" | "revealed") =>
  renderToStaticMarkup(
    <People
      participants={
        phase === "voting" ? JOIN_ORDER.map(voting) : JOIN_ORDER.map(revealed)
      }
      viewerId="Ada"
      scores={scores}
    />,
  );

describe("the people list with Keep score", () => {
  it.each(["voting", "revealed"] as const)(
    "shows no points at all while it is off (%s)",
    (phase) => {
      const html = renderPeople(null, phase);
      expect(html).not.toContain("person-points");
      expect(html).not.toMatch(/\bpts?\b|points?\b/);
    },
  );

  it.each(["voting", "revealed"] as const)(
    "orders by points and ends each row with them (%s)",
    (phase) => {
      const html = renderPeople({ Ada: 1, Ben: 3, Cy: 0, Dee: 1 }, phase);
      const names = [...html.matchAll(/class="person-name">([^<]+)</g)].map(
        (m) => m[1],
      );
      expect(names).toEqual(["Ben", "Ada", "Dee", "Cy"]);
      expect(html).toContain(
        '<span class="person-points"><span aria-hidden="true">3 pts</span><span class="visually-hidden">3 points</span></span></li>',
      );
    },
  );

  it("says one point in the singular, and 0 as 0", () => {
    const html = renderPeople({ Ada: 1, Ben: 0, Cy: 0, Dee: 0 }, "voting");
    expect(html).toContain(
      '<span aria-hidden="true">1 pt</span><span class="visually-hidden">1 point</span>',
    );
    expect(html).toContain(
      '<span aria-hidden="true">0 pts</span><span class="visually-hidden">0 points</span>',
    );
  });
});

describe("Keep score in the Menu", () => {
  const theme: ThemeStore = {
    getTheme: () => "system",
    subscribe: () => () => undefined,
    setTheme: () => undefined,
  };
  const facilitate: FacilitateStore = {
    isOn: () => true,
    subscribe: () => () => undefined,
    set: () => undefined,
  };
  const menu = (scoring?: { on: boolean; live: boolean }) =>
    renderToStaticMarkup(
      <Header
        theme={theme}
        menuOpen
        layout="wide"
        room={{
          facilitate,
          link: "http://localhost/r/abcdefghijk",
          onLeave: () => undefined,
          scoring: scoring && { ...scoring, onChange: () => undefined },
        }}
      />,
    );

  it("is there only when given, which is the facilitator view", () => {
    expect(menu()).not.toContain("Keep score");
    expect(menu({ on: false, live: true })).toContain("Keep score");
  });

  it("comes first, above Facilitate, with its description", () => {
    const html = menu({ on: false, live: true });
    expect(html.indexOf("Keep score")).toBeLessThan(html.indexOf("Facilitate"));
    expect(html).toContain(
      "Shows everyone&#x27;s points: one when a vote matches the result. For this session only.",
    );
  });

  it("is a switch showing the room's setting, disabled while reconnecting", () => {
    const keepScore = (html: string) =>
      /<button[^>]*role="switch"[^>]*>/.exec(
        html.slice(html.indexOf("Keep score")),
      )?.[0] ?? "";
    expect(keepScore(menu({ on: true, live: true }))).toContain(
      'aria-checked="true"',
    );
    expect(keepScore(menu({ on: false, live: true }))).not.toContain(
      "disabled",
    );
    expect(keepScore(menu({ on: false, live: false }))).toContain("disabled");
  });
});
