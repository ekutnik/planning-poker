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

function inRoom(on: boolean, menuOpen = false): string {
  return renderToStaticMarkup(
    <Header
      theme={theme}
      menuOpen={menuOpen}
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
      `<span id="${note}" class="menu-note">Hides your vote so you can share your screen.</span>`,
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
