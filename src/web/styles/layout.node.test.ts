import { describe, expect, it } from "vitest";
import { WIDE_MIN_WIDTH, WIDE_QUERY } from "../breakpoint.js";
import { declarations, readStyles, split } from "./css.node.js";

const css = readStyles();

describe("names on the scale (A-04)", () => {
  const scaleName = declarations(css, ".scale-name");

  it("keep each name on one line, cut short visually when too long", () => {
    expect(scaleName).toMatch(/white-space:\s*nowrap/);
    expect(scaleName).toMatch(/overflow:\s*hidden/);
    expect(scaleName).toMatch(/text-overflow:\s*ellipsis/);
    expect(scaleName).toMatch(/max-inline-size:\s*100%/);
  });

  it("never break a name mid-word, where it would read as two people", () => {
    expect(scaleName).not.toMatch(/overflow-wrap|word-break/);
  });
});

describe("the pinned facilitator bar (A-05)", () => {
  const tall = split(css, "(height >= 25em) and (width < 55em)");

  it("is pinned only in compact, when the window is tall enough", () => {
    expect(tall.inside).toMatch(/position:\s*sticky/);
    expect(tall.outside).not.toMatch(/position:\s*sticky/);
  });

  it("fits a button, its padding and its rule in the height reserved for it", () => {
    // The scroll padding reserves --controls-bar-height; if the bar grows
    // past it (a taller button, more padding), focus can end under the bar.
    const rem = (value: string | undefined) => {
      const match = /([\d.]+)(rem|px)/.exec(value ?? "");
      if (!match) throw new Error(`no length in ${value ?? "nothing"}`);
      return Number(match[1]) / (match[2] === "px" ? 16 : 1);
    };
    const reserved = rem(/--controls-bar-height:\s*([^;]+)/.exec(css)?.[1]);
    const button = rem(
      /min-height:\s*([^;]+)/.exec(declarations(css, "button"))?.[1],
    );
    const bar = declarations(css, ".round--facilitator .controls");
    const padding = /padding-block:\s*var\(--space-(\d+)\)/.exec(bar)?.[1];
    const rule = /border-block-start:\s*([\d.]+px)/.exec(bar)?.[1];
    expect(button + 2 * (Number(padding) / 16) + rem(rule)).toBeLessThanOrEqual(
      reserved,
    );
  });

  it("reserves scroll room for itself only while pinned", () => {
    const reserved = /scroll-padding-block-end:\s*calc/;
    expect(tall.inside).toMatch(reserved);
    expect(tall.outside).not.toMatch(reserved);
  });
});

describe("the Menu's panel (#48)", () => {
  it("never sets display on the panel itself, so hidden really hides it", () => {
    // A display rule on .menu-panel would override the hidden attribute.
    expect(declarations(css, ".menu-panel")).not.toMatch(/display\s*:/);
    expect(declarations(css, ".menu-panel:not([hidden])")).toMatch(
      /display:\s*flex/,
    );
  });

  it("is positioned against the Menu itself", () => {
    expect(declarations(css, ".menu")).toMatch(/position:\s*relative/);
  });
});

describe("one breakpoint (docs/design.md, Layout)", () => {
  const preludes = [...css.matchAll(/@media\s*([^{]+)\{/g)].map(
    ([, prelude = ""]) => prelude.trim(),
  );
  const widthPreludes = preludes.filter((prelude) => /width/.test(prelude));

  it("is found in the stylesheets, so the checks below are not vacuous", () => {
    expect(widthPreludes.length).toBeGreaterThan(2);
  });

  it("uses the script's breakpoint in every width query", () => {
    for (const prelude of widthPreludes) {
      const lengths = [
        ...prelude.matchAll(/width\s*(?::|<=?|>=?)\s*([\d.]+[a-z]+)/g),
      ].map(([, length]) => length);
      expect(lengths.length).toBeGreaterThan(0);
      for (const length of lengths) expect(length).toBe(WIDE_MIN_WIDTH);
    }
  });

  it("writes every min-width query exactly as useWide does", () => {
    for (const prelude of widthPreludes.filter((p) =>
      p.includes("min-width"),
    )) {
      expect(prelude).toBe(WIDE_QUERY);
    }
  });
});

describe("the deck and its cards (7b)", () => {
  it("draws every card at 4:5, with an Edge outline and a Surface fill", () => {
    const card = declarations(css, ".card");
    expect(card).toMatch(/aspect-ratio:\s*4\s*\/\s*5/);
    expect(card).toMatch(/border:\s*1\.5px solid var\(--edge\)/);
    expect(card).toMatch(/background:\s*var\(--surface\)/);
  });

  it("lays out two rows of five, or ten in a row when the deck has room", () => {
    expect(declarations(css, ".deck")).toMatch(
      /grid-template-columns:\s*repeat\(5,/,
    );
    // Ten 68px cards and nine 12px gaps: 788px, 49.25rem.
    const ten =
      /@container deck \(min-width: ([\d.]+)rem\)\s*\{\s*\.deck\s*\{\s*grid-template-columns:\s*repeat\(10, 4\.25rem\)/.exec(
        css,
      );
    expect(Number(ten?.[1])).toBe((10 * 68 + 9 * 12) / 16);
  });

  it("styles hover only where a pointer can hover", () => {
    // On a phone a tap leaves :hover on the card, which reads as a vote.
    const { inside, outside } = split(css, "(hover: hover)");
    expect(inside).toMatch(/\.card:hover/);
    expect(outside).not.toMatch(/\.card:hover/);
  });

  it("lifts a card on hover only when motion is allowed, too", () => {
    const { inside } = split(
      css,
      "(hover: hover) and (prefers-reduced-motion: no-preference)",
    );
    expect(inside).toMatch(/\.card:hover:not\(:disabled\)\s*\{\s*transform/);
    const rest = split(
      css,
      "(hover: hover) and (prefers-reduced-motion: no-preference)",
    ).outside;
    expect(rest).not.toMatch(/\.card:hover[^{]*\{[^}]*transform/);
  });

  it("settles a pressed card back down, after the lift so it wins", () => {
    const { inside } = split(
      css,
      "(hover: hover) and (prefers-reduced-motion: no-preference)",
    );
    const lift = inside.search(/\.card:hover:not\(:disabled\)\s*\{/);
    const press = inside.search(
      /\.card:active:not\(:disabled\)\s*\{\s*transform:\s*none/,
    );
    expect(lift).toBeGreaterThanOrEqual(0);
    expect(press).toBeGreaterThan(lift);
  });
});

describe("the room's status line (7b)", () => {
  it("is quiet: Quiet colour, regular weight", () => {
    const status = declarations(css, ".status");
    expect(status).toMatch(/color:\s*var\(--quiet\)/);
    expect(status).toMatch(/font-weight:\s*var\(--weight-regular\)/);
  });
});
