import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { RoomView } from "./RoomView.js";
import { Ticket } from "./Ticket.js";

/**
 * The ticket above the room (Ticket): what each view shows, with and
 * without a ticket. Editing, focus and the announcement are clicks and
 * speech, so they are in the end-to-end suite (e2e/ticket.e2e.ts).
 */

const render = (ticket: string | null, facilitating: boolean) =>
  renderToStaticMarkup(
    <Ticket
      ticket={ticket}
      facilitating={facilitating}
      live
      onSave={() => undefined}
    />,
  );

const TICKET = "PROJ-482 Admins can sign in with SSO";

describe("the ticket, participant view", () => {
  it("shows nothing at all while there is no ticket", () => {
    expect(render(null, false)).toBe("");
  });

  it("shows the label and the ticket, as paragraphs, with no controls", () => {
    expect(render(TICKET, false)).toBe(
      '<div class="ticket"><div class="ticket-words"><p class="ticket-label">Now estimating</p><p class="ticket-text">PROJ-482 Admins can sign in with SSO</p></div></div>',
    );
  });
});

describe("the ticket, facilitator view", () => {
  it("offers only Add a ticket while there is none", () => {
    const html = render(null, true);
    expect(html).toContain(">Add a ticket</button>");
    expect(html).not.toContain("Now estimating");
  });

  it("puts Edit beside the ticket, named for a screen reader", () => {
    const html = render(TICKET, true);
    expect(html).toContain(TICKET);
    expect(html).toMatch(
      /<button type="button" class="ticket-button">Edit<span class="visually-hidden"> the ticket<\/span><\/button>/,
    );
  });
});

describe("the ticket in any view", () => {
  it.each([true, false])(
    "is never a heading (facilitating: %s): the status line stays the h1",
    (facilitating) => {
      expect(render(TICKET, facilitating)).not.toMatch(/<h[1-6]/);
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
    yourVote: null,
    participants: [
      { id: "ada", name: "Ada", status: "connected", hasVoted: false },
    ],
  });
  const renderRoom = (ticket: string | null, facilitating: boolean) =>
    renderToStaticMarkup(
      <RoomView
        snapshot={room(ticket)}
        facilitating={facilitating}
        live
        banner={null}
        notice={null}
        persistent
        onAction={() => undefined}
      />,
    );

  it("sits above the round, before its h1", () => {
    const html = renderRoom(TICKET, false);
    expect(html.indexOf('class="ticket"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="ticket"')).toBeLessThan(html.indexOf("<h1"));
  });

  it("leaves the room exactly as before for a participant while there is no ticket", () => {
    // Nothing new on screen until someone adds a ticket.
    expect(renderRoom(null, false)).not.toContain("ticket");
  });

  it("goes to everyone the same: both views show the same text", () => {
    for (const facilitating of [true, false]) {
      expect(renderRoom(TICKET, facilitating)).toContain(
        `<p class="ticket-text">${TICKET}</p>`,
      );
    }
  });
});
