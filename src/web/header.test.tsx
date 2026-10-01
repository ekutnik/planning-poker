import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FacilitateStore } from "./facilitate.js";
import { Header } from "./Header.js";
import type { ThemeStore } from "./theme.js";

const theme: ThemeStore = {
  getTheme: () => "system",
  subscribe: () => () => undefined,
  setTheme: () => undefined,
};

const facilitate = (on: boolean): FacilitateStore => ({
  isOn: () => on,
  subscribe: () => () => undefined,
  set: () => undefined,
});

function inRoom(
  on: boolean,
  menuOpen = false,
  layout: "wide" | "compact" = "wide",
): string {
  return renderToStaticMarkup(
    <Header
      theme={theme}
      menuOpen={menuOpen}
      layout={layout}
      room={{
        facilitate: facilitate(on),
        link: "http://localhost/r/abcdefghijk",
        onLeave: () => undefined,
      }}
    />,
  );
}

/** The Menu button's tag, and whatever follows it in the page. */
function menuButton(html: string): { tag: string; after: string } {
  const match =
    /(<button[^>]*class="menu-button"[^>]*>)[\s\S]*?<\/button>([\s\S]*)/.exec(
      html,
    );
  return { tag: match?.[1] ?? "", after: match?.[2] ?? "" };
}

describe("the header", () => {
  it("names the product with its mark, never the room", () => {
    const html = inRoom(false);
    expect(html).toContain(
      '<span class="wordmark">Planning Poker Session</span>',
    );
    expect(html).toMatch(/<svg class="brand-mark"[^>]*aria-hidden="true"/);
    expect(html).not.toContain("abcdefghijk");
  });

  it("shows the Facilitating pill only while facilitating", () => {
    expect(inRoom(true)).toContain(
      '<span class="pill pill--facilitating">Facilitating</span>',
    );
    expect(inRoom(false)).not.toContain("Facilitating</span>");
  });

  it("orders the controls: pill, Copy link, Menu", () => {
    const html = inRoom(true);
    const pill = html.indexOf("pill--facilitating");
    const copy = html.indexOf(">Copy link<");
    const menu = html.indexOf('class="menu-button"');
    expect(pill).toBeLessThan(copy);
    expect(copy).toBeLessThan(menu);
  });
});

describe("the Menu, a disclosure", () => {
  it("is a button named Menu that controls the panel right after it", () => {
    const { tag, after } = menuButton(inRoom(true));
    expect(tag).toContain('aria-label="Menu"');
    const controls = /aria-controls="([^"]+)"/.exec(tag)?.[1];
    expect(controls).toBeDefined();
    // Next in the page, so Tab goes from the button into the panel.
    expect(
      after.startsWith(`<div id="${controls ?? ""}" class="menu-panel"`),
    ).toBe(true);
  });

  it("says it is closed, and hides the panel, until opened", () => {
    const { tag, after } = menuButton(inRoom(true));
    expect(tag).toContain('aria-expanded="false"');
    expect(after).toMatch(/^<div[^>]*class="menu-panel" hidden="">/);
  });

  it("says it is open, and shows the panel, when open", () => {
    const { tag, after } = menuButton(inRoom(true, true));
    expect(tag).toContain('aria-expanded="true"');
    expect(after).toMatch(/^<div[^>]*class="menu-panel">/);
  });

  it("holds Facilitate, Theme and Leave the room in a room, in that order", () => {
    const { after } = menuButton(inRoom(true, true));
    const facilitate = after.indexOf('role="switch"');
    const theme = after.indexOf(">Theme<");
    const leave = after.indexOf(">Leave the room<");
    expect(facilitate).toBeGreaterThan(-1);
    expect(facilitate).toBeLessThan(theme);
    expect(theme).toBeLessThan(leave);
    expect(after).toMatch(/<hr class="menu-divider"\/>[\s\S]*Leave the room/);
  });

  it("describes Facilitate as a switch, with its note", () => {
    const html = inRoom(true, true);
    const control = /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";
    expect(control).toContain('aria-checked="true"');
    const note = /aria-describedby="([^"]+)"/.exec(control)?.[1] ?? "";
    expect(html).toContain(
      `<span id="${note}" class="switch-note">Hides your vote so you can share your screen.</span>`,
    );
    expect(inRoom(false, true)).toMatch(
      /role="switch"[^>]*aria-checked="false"/,
    );
  });

  it("holds only Theme outside a room", () => {
    const html = renderToStaticMarkup(<Header theme={theme} menuOpen />);
    expect(html).toContain(">Theme<");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("Leave the room");
    expect(html).not.toContain("Copy link");
    expect(html).not.toContain("Facilitating");
  });
});

describe("Copy link, by layout", () => {
  const copies = (html: string) => html.match(/>Copy link</g)?.length ?? 0;

  it("is in the header when wide, and only there", () => {
    const html = inRoom(true, true, "wide");
    expect(copies(html)).toBe(1);
    const { tag, after } = menuButton(html);
    expect(html.indexOf(">Copy link<")).toBeLessThan(html.indexOf(tag));
    expect(after).not.toContain("Copy link");
  });

  it("is the Menu's first item when compact, and only there", () => {
    const html = inRoom(true, true, "compact");
    // In the page once, not twice with one hidden: a screen reader would
    // find both.
    expect(copies(html)).toBe(1);
    const { tag, after } = menuButton(html);
    expect(html.indexOf(">Copy link<")).toBeGreaterThan(html.indexOf(tag));
    expect(after.indexOf(">Copy link<")).toBeLessThan(
      after.indexOf('role="switch"'),
    );
  });

  it("keeps the pill beside the Menu in compact", () => {
    const html = inRoom(true, false, "compact");
    const { tag } = menuButton(html);
    expect(html.indexOf("pill--facilitating")).toBeLessThan(html.indexOf(tag));
  });
});

describe("the Menu's Session tools (facilitator view)", () => {
  const tools = ({
    ticket = false,
    timer = false,
    busy = false,
    live = true,
  } = {}) =>
    renderToStaticMarkup(
      <Header
        theme={theme}
        menuOpen
        layout="wide"
        room={{
          facilitate: facilitate(true),
          link: "http://localhost/r/abcdefghijk",
          onLeave: () => undefined,
          ticket: { on: ticket, live, onChange: () => undefined },
          timer: { on: timer, busy, onChange: () => undefined },
          scoring: { on: false, live, onChange: () => undefined },
        }}
      />,
    );
  const switchFor = (html: string, label: string) =>
    /<button[^>]*role="switch"[^>]*>/.exec(
      html.slice(html.indexOf(`>${label}</label>`)),
    )?.[0] ?? "";

  it("groups Ticket, Timer and Keep score, then Facilitate and Theme, then Leave", () => {
    const { after } = menuButton(tools());
    const order = [
      ">Session tools<",
      ">Ticket name<",
      ">Timer<",
      ">Keep score<",
      '<hr class="menu-divider"/>',
      ">Just for you<",
      ">Facilitate<",
      ">Theme<",
      ">Leave the room<",
    ].map((text) => after.indexOf(text));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(after.match(/<hr class="menu-divider"\/>/g)).toHaveLength(2);
  });

  it("names each group by its words, which are not headings", () => {
    const html = tools();
    for (const name of ["Session tools", "Just for you"]) {
      const id = new RegExp(
        `<p id="([^"]+)" class="menu-heading">${name}</p>`,
      ).exec(html)?.[1];
      expect(id).toBeDefined();
      expect(html).toContain(
        `<div role="group" aria-labelledby="${id ?? ""}" class="menu-group">`,
      );
    }
    expect(html).not.toMatch(/<h[1-6]/);
  });

  it("describes each tool", () => {
    const html = tools();
    expect(html).toContain("Show what the room is estimating.");
    expect(html).toContain("Reveal the votes when time runs out.");
  });

  it("shows this browser's Ticket name and Timer as switches", () => {
    expect(switchFor(tools(), "Ticket name")).toContain('aria-checked="false"');
    expect(switchFor(tools({ ticket: true }), "Ticket name")).toContain(
      'aria-checked="true"',
    );
    expect(switchFor(tools({ timer: true }), "Timer")).toContain(
      'aria-checked="true"',
    );
  });

  it("holds Timer on, with the reason, while a timer runs or is paused", () => {
    const busy = tools({ timer: true, busy: true });
    expect(switchFor(busy, "Timer")).toContain('disabled=""');
    expect(busy).toContain("Available once the timer has stopped.");
    expect(busy).not.toContain("Reveal the votes when time runs out.");
    const idle = tools({ timer: true });
    expect(switchFor(idle, "Timer")).not.toContain("disabled");
    expect(idle).not.toContain("Available once");
  });

  it("waits for the room before Ticket can change, since off clears the room's ticket", () => {
    expect(switchFor(tools({ live: false }), "Ticket name")).toContain(
      'disabled=""',
    );
    expect(switchFor(tools(), "Ticket name")).not.toContain("disabled");
  });

  it("is not there outside the facilitator view: no groups, as before", () => {
    const { after } = menuButton(inRoom(false, true));
    expect(after).not.toContain("Session tools");
    expect(after).not.toContain("Just for you");
    expect(after.match(/role="switch"/g)).toHaveLength(1);
  });
});
