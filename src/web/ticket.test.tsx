import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { RoomView } from "./RoomView.js";
import { Ticket } from "./Ticket.js";

/**
 * The ticket slot (Ticket): what each view shows, with and
 * without a ticket. Editing, focus and the announcement are clicks and
 * speech, so they are in the end-to-end suite (e2e/ticket.e2e.ts).
 */

const render = (ticket: string | null, editable: boolean) =>
  renderToStaticMarkup(
    <Ticket
      ticket={ticket}
      editable={editable}
      live
      onSave={() => undefined}
    />,
  );

const TICKET = "PROJ-482 Admins can sign in with SSO";

describe("the ticket, read only", () => {
  it("keeps its slot, empty, while there is no ticket", () => {
    // In wide the slot holds the action row at its height, so a ticket
    // arriving moves nothing below it.
    expect(render(null, false)).toBe('<div class="ticket"></div>');
  });

  it("shows the label and the ticket on one line, whole in its title, with no controls", () => {
    expect(render(TICKET, false)).toBe(
      `<div class="ticket"><p class="ticket-label">Now estimating</p><div class="ticket-row"><p class="ticket-text" title="${TICKET}">${TICKET}</p></div></div>`,
    );
  });
});

describe("the ticket, editable (facilitator view, Ticket on)", () => {
  it("offers Add a ticket under the label while there is none", () => {
    const html = render(null, true);
    expect(html).toMatch(
      /^<div class="ticket"><p class="ticket-label">Now estimating<\/p><div class="ticket-row"><button type="button" class="small-button small-button--quiet"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Add a ticket<\/button><\/div><\/div>$/,
    );
  });

  it("puts Edit beside the ticket, with a pencil, named for a screen reader", () => {
    const html = render(TICKET, true);
    expect(html).toContain(TICKET);
    expect(html).toMatch(
      /<button type="button" class="small-button small-button--quiet"><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Edit<span class="visually-hidden"> the ticket<\/span><\/button>/,
    );
  });
});

describe("the ticket in any view", () => {
  it.each([true, false])(
    "is never a heading (editable: %s): the status line stays the h1",
    (editable) => {
      expect(render(TICKET, editable)).not.toMatch(/<h[1-6]/);
    },
  );

  it("shows markup as the text that was typed", () => {
    const html = render("<b>x</b> & <script>", false);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("the ticket in the room", () => {
  const room = (ticket: string | null): RoomSnapshot => ({
    phase: "voting",
    roomId: "abcdefghijk",
    version: 3,
    viewerId: "ada",
    ticket,
    scores: null,
    timer: {
      durationMs: 60_000,
      state: "idle",
      endsAt: null,
      remainingMs: null,
    },
    yourVote: null,
    participants: [
      { id: "ada", name: "Ada", status: "connected", hasVoted: false },
    ],
  });
  const renderRoom = (
    ticket: string | null,
    facilitating: boolean,
    tools = { ticket: true, timer: false },
  ) =>
    renderToStaticMarkup(
      <RoomView
        snapshot={room(ticket)}
        facilitating={facilitating}
        live
        banner={null}
        notice={null}
        persistent
        tools={tools}
        onAction={() => undefined}
      />,
    );
  const off = { ticket: false, timer: false };

  it("sits first in the round, before its h1", () => {
    const html = renderRoom(TICKET, false);
    expect(html.indexOf('class="ticket"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="ticket"')).toBeLessThan(html.indexOf("<h1"));
  });

  it("keeps its slot for a participant while there is no ticket, and nothing else is new", () => {
    const html = renderRoom(null, false);
    expect(html).toContain('<div class="ticket"></div>');
    expect(html).not.toContain("Now estimating");
    // On a phone there is no block at the top for it.
    expect(html).not.toContain("round--tooled");
  });

  it("goes to everyone the same: every view shows the same text", () => {
    for (const facilitating of [true, false]) {
      for (const tools of [off, { ticket: true, timer: false }]) {
        expect(renderRoom(TICKET, facilitating, tools)).toContain(
          `<p class="ticket-text" title="${TICKET}">${TICKET}</p>`,
        );
      }
    }
  });

  it("is editable only in the facilitator view with Ticket on", () => {
    expect(renderRoom(TICKET, true)).toContain("Edit<span");
    expect(renderRoom(null, true)).toContain("Add a ticket");
    // Ticket off: someone else's ticket still shows, read only.
    expect(renderRoom(TICKET, true, off)).not.toContain(
      '<button type="button" class="small-button',
    );
    expect(renderRoom(null, true, off)).not.toContain("Add a ticket");
    // A participant's own settings change nothing.
    expect(renderRoom(TICKET, false)).not.toContain("Edit<span");
  });

  it("gives the phone its top block only while there is something in it", () => {
    expect(renderRoom(TICKET, false)).toContain("round--tooled");
    expect(renderRoom(null, true)).toContain("round--tooled");
    expect(renderRoom(null, true, off)).not.toContain("round--tooled");
  });
});
