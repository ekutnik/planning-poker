import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StopReason } from "./connection/policy.js";
import { STOP_ACTION_LABELS, STOP_COPY } from "./copy.js";
import { NameForm } from "./NameForm.js";
import { StoppedScreen } from "./StoppedScreen.js";
import { STOP_ACTIONS } from "./view.js";

const REASONS = Object.keys(STOP_COPY) as StopReason[];

describe("the stopped screens", () => {
  it.each(REASONS)(
    "%s: a heading, what to do, and exactly one way on, as the primary action",
    (reason) => {
      const html = renderToStaticMarkup(
        <StoppedScreen
          reason={reason}
          onRestart={() => undefined}
          onReload={() => undefined}
          onChangeName={() => undefined}
          onHome={() => undefined}
        />,
      );
      const { title, body } = STOP_COPY[reason];
      const label = STOP_ACTION_LABELS[STOP_ACTIONS[reason]];
      expect(html).toContain(`<h1>${escape(title)}</h1>`);
      expect(html).toContain(`<p>${escape(body)}</p>`);
      expect(html.match(/<button/g)).toHaveLength(1);
      expect(html).toContain(`class="primary">${label}</button>`);
    },
  );
});

describe("the name form", () => {
  it("labels the field, keeps a live message slot, and has one primary button", () => {
    const html = renderToStaticMarkup(
      <NameForm initial="Ada" submitLabel="Join" onSubmit={() => undefined} />,
    );
    expect(html).toMatch(
      /<label for="([^"]+)">Your name<\/label><input id="\1"/,
    );
    expect(html).toContain('value="Ada"');
    expect(html).toMatch(/role="alert" class="field-message"><\/p>/);
    expect(html).toContain(
      '<button type="submit" class="primary">Join</button>',
    );
  });
});

/** How React escapes text: enough for the copy here. */
function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;");
}
