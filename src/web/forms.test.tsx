import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createFacilitateStore } from "./facilitate.js";
import { HomePage } from "./HomePage.js";
import type { Identity } from "./identity.js";
import { JoinScreen } from "./RoomPage.js";

const identity: Identity = {
  sessionToken: "t".repeat(32),
  persistent: true,
  lastName: () => null,
  rememberName: () => undefined,
};

// A store already on: the forms start from their own default, not from it.
const data = new Map([["planning-poker:facilitate", "on"]]);
const facilitate = createFacilitateStore(() => ({
  getItem: (key) => data.get(key) ?? null,
  setItem: (key, value) => void data.set(key, value),
}));

const home = renderToStaticMarkup(
  <HomePage
    identity={identity}
    facilitate={facilitate}
    onCreated={() => undefined}
  />,
);
const join = renderToStaticMarkup(<JoinScreen onJoin={() => undefined} />);

const theSwitch = (html: string) =>
  /<button[^>]*role="switch"[^>]*>/.exec(html)?.[0] ?? "";

describe("the Facilitate switch on the forms", () => {
  it("starts on to create a room, and off to join one", () => {
    expect(theSwitch(home)).toContain('aria-checked="true"');
    expect(theSwitch(join)).toContain('aria-checked="false"');
  });

  it("is named by its label and described by its note", () => {
    for (const html of [home, join]) {
      const control = theSwitch(html);
      const id = /id="([^"]+)"/.exec(control)?.[1] ?? "";
      expect(html).toContain(
        `<label for="${id}" class="switch-label">I&#x27;m running this session</label>`,
      );
      expect(control).toContain(`aria-describedby="${id}-note"`);
      expect(html).toContain(
        `<span id="${id}-note" class="switch-note">Hides your vote so you can share your screen.</span>`,
      );
    }
  });

  it("sits between the name and the button, a button that never submits", () => {
    for (const html of [home, join]) {
      const field = html.indexOf("<input");
      const control = html.indexOf('role="switch"');
      const submit = html.indexOf('type="submit"');
      expect(field).toBeLessThan(control);
      expect(control).toBeLessThan(submit);
      expect(theSwitch(html)).toContain('type="button"');
    }
  });
});
