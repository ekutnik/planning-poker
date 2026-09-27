import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPreview } from "./LandingPreview.js";
import { PREVIEW_FRAMES, REVEALED_FRAME, previewStep } from "./preview.js";
import { resultCopy } from "./result.js";

/** The element opening at `start`, whole: its tag counted to its close. */
function element(html: string, start: number): string {
  const tag = /^<([a-z]+)/.exec(html.slice(start))?.[1] ?? "";
  const pattern = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  pattern.lastIndex = start;
  let depth = 0;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, pattern.lastIndex);
  }
  throw new Error(`<${tag}> at ${String(start)} never closes`);
}

/** Every element a keyboard could reach, as its opening tag. */
const focusable = (html: string) =>
  html.match(
    /<(?:button|input|select|textarea|a\s[^>]*href)[^>]*>|<[a-z]+[^>]*tabindex="(?!-1")[^>]*>/g,
  ) ?? [];

/** The preview split into its fake room and everything around it. */
function parts(html: string) {
  const start = html.indexOf('<div class="preview-room"');
  const room = element(html, start);
  return { room, around: html.replace(room, "") };
}

const render = (initialFrame: number, reducedMotion = false) =>
  renderToStaticMarkup(
    <LandingPreview
      initialFrame={initialFrame}
      reducedMotion={reducedMotion}
    />,
  );

describe("the preview's script", () => {
  it("plays one round in about ten seconds, ending on the reveal", () => {
    const total = PREVIEW_FRAMES.reduce((sum, { ms }) => sum + ms, 0);
    expect(total).toBeGreaterThanOrEqual(9000);
    expect(total).toBeLessThanOrEqual(11000);
    expect(REVEALED_FRAME).toBe(PREVIEW_FRAMES.length - 1);
  });

  it("reveals the result the real sentence gives", () => {
    const room = PREVIEW_FRAMES[REVEALED_FRAME]?.room;
    expect(room?.phase).toBe("revealed");
    if (room?.phase !== "revealed") return;
    expect(resultCopy(room).summary).toBe("Spread from 5 to 8. Result: 5.");
  });
});

describe("previewStep: when the preview moves", () => {
  it("moves on after each frame's time, and wraps to the start", () => {
    expect(previewStep(0, true, false)).toEqual({
      frame: 0,
      next: { frame: 1, ms: PREVIEW_FRAMES[0]?.ms },
    });
    expect(previewStep(REVEALED_FRAME, true, false).next?.frame).toBe(0);
  });

  it("stops on the frame showing when paused", () => {
    expect(previewStep(2, false, false)).toEqual({ frame: 2, next: null });
  });

  it("never moves with reduced motion, and shows the revealed frame", () => {
    for (const index of PREVIEW_FRAMES.keys()) {
      for (const playing of [true, false]) {
        expect(previewStep(index, playing, true)).toEqual({
          frame: REVEALED_FRAME,
          next: null,
        });
      }
    }
  });
});

describe("the preview, kept out of the way", () => {
  it.each([...PREVIEW_FRAMES.keys()])(
    "frame %i: nothing in the fake room can take focus or be read out",
    (index) => {
      const { room, around } = parts(render(index));
      expect(room).toMatch(
        /^<div class="preview-room" inert="" aria-hidden="true">/,
      );
      // The room is real: the voting frames carry the deck's buttons, and
      // inert is what keeps them out of the Tab order.
      if (index !== REVEALED_FRAME) {
        expect(focusable(room).length).toBeGreaterThan(0);
      }
      // Outside the inert room, the one control is Pause preview.
      expect(focusable(around)).toEqual([
        '<button type="button" class="secondary preview-toggle">',
      ]);
      expect(around).toContain(">Pause preview</button>");
    },
  );

  it("has no heading of its own, so the page keeps its one h1", () => {
    for (const index of PREVIEW_FRAMES.keys()) {
      expect(render(index)).not.toMatch(/<h[1-6]/);
    }
  });

  it("shows the revealed frame, still and with no button, with reduced motion", () => {
    const html = render(0, true);
    expect(html).toContain("Spread from 5 to 8. Result: 5.");
    expect(focusable(parts(html).around)).toEqual([]);
  });
});
