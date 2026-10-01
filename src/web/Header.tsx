import { useId, useSyncExternalStore, type ReactNode } from "react";
import { HEADER_COPY, PRODUCT_NAME, SCORE_COPY, TOOLS_COPY } from "./copy.js";
import { CopyLinkButton } from "./CopyLinkButton.js";
import type { FacilitateStore } from "./facilitate.js";
import { FacilitateSwitch } from "./FacilitateSwitch.js";
import { HeaderMenu } from "./HeaderMenu.js";
import { useWide } from "./layout.js";
import { Mark } from "./Mark.js";
import { SwitchRow } from "./SwitchRow.js";
import type { ThemeStore } from "./theme.js";
import { ThemeMenu } from "./ThemeMenu.js";

/** What the header adds inside a room. */
export interface RoomHeader {
  readonly facilitate: FacilitateStore;
  /** The room's own link, copied but never shown: it is the credential. */
  readonly link: string;
  readonly onLeave: () => void;
  /**
   * The Session tools, given only in the facilitator view, once the room is
   * shown. Keep score is the whole room's; `live` is false while it
   * reconnects.
   */
  readonly scoring?: {
    readonly on: boolean;
    readonly live: boolean;
    readonly onChange: (on: boolean) => void;
  };
  /**
   * Ticket, this browser's. Switching it off clears a ticket for the room,
   * which needs the room, so it waits for `live` as Keep score does.
   */
  readonly ticket?: {
    readonly on: boolean;
    readonly live: boolean;
    readonly onChange: (on: boolean) => void;
  };
  /**
   * Timer, this browser's. `busy` while it is on and a timer runs or is
   * paused: switching it off then would hide the controls of a timer that
   * is still counting, so it waits until the timer has stopped.
   */
  readonly timer?: {
    readonly on: boolean;
    readonly busy: boolean;
    readonly onChange: (on: boolean) => void;
  };
}

/**
 * The same header on every screen: the mark and the product's name, then
 * the controls. The title is fixed: rooms have no names yet (#35), and the
 * room id must never stand in for one, because it is the room's credential
 * and the facilitator's screen is shared. In a room: the Facilitating pill
 * (only while on), Copy link, and a Menu: in the facilitator view, first
 * the Session tools (Ticket, Timer, Keep score), then Just for you
 * (Facilitate, Theme); otherwise Facilitate and Theme alone; then Leave the
 * room. Elsewhere the Menu holds Theme alone.
 *
 * In compact, Copy link moves into the Menu, first, so the pill and the
 * Menu fit beside the name in one row: it is used once a session, by
 * whoever creates the room. It is rendered in one place or the other, never
 * both, so a screen reader never finds two.
 */
export function Header({
  theme,
  room,
  menuOpen = false,
  layout,
}: {
  readonly theme: ThemeStore;
  readonly room?: RoomHeader;
  /** For tests of the open markup. */
  readonly menuOpen?: boolean;
  /** For tests; otherwise the window decides. */
  readonly layout?: "wide" | "compact";
}) {
  const windowIsWide = useWide();
  const wide = layout === undefined ? windowIsWide : layout === "wide";
  const copyLink = room && <CopyLinkButton link={room.link} />;
  return (
    <header className="app-header">
      <div className="brand">
        <Mark className="brand-mark" />
        <span className="wordmark">{PRODUCT_NAME}</span>
      </div>
      <div className="header-controls">
        {room && <FacilitatingPill store={room.facilitate} />}
        {wide && copyLink}
        <HeaderMenu defaultOpen={menuOpen}>
          {!wide && copyLink}
          {room && hasSessionTools(room) ? (
            <>
              <MenuGroup heading={HEADER_COPY.sessionTools}>
                {room.ticket && (
                  <SwitchRow
                    label={TOOLS_COPY.ticket}
                    note={TOOLS_COPY.ticketNote}
                    checked={room.ticket.on}
                    disabled={!room.ticket.live}
                    onChange={room.ticket.onChange}
                  />
                )}
                {room.timer && (
                  <SwitchRow
                    label={TOOLS_COPY.timer}
                    note={
                      room.timer.busy
                        ? TOOLS_COPY.timerBusy
                        : TOOLS_COPY.timerNote
                    }
                    checked={room.timer.on}
                    disabled={room.timer.busy}
                    onChange={room.timer.onChange}
                  />
                )}
                {room.scoring && (
                  <SwitchRow
                    label={SCORE_COPY.label}
                    note={SCORE_COPY.note}
                    checked={room.scoring.on}
                    disabled={!room.scoring.live}
                    onChange={room.scoring.onChange}
                  />
                )}
              </MenuGroup>
              <hr className="menu-divider" />
              <MenuGroup heading={HEADER_COPY.justForYou}>
                <FacilitateSwitch store={room.facilitate} />
                <ThemeMenu store={theme} />
              </MenuGroup>
            </>
          ) : (
            <>
              {room && <FacilitateSwitch store={room.facilitate} />}
              <ThemeMenu store={theme} />
            </>
          )}
          {room && (
            <>
              <hr className="menu-divider" />
              <button type="button" onClick={room.onLeave}>
                {HEADER_COPY.leave}
              </button>
            </>
          )}
        </HeaderMenu>
      </div>
    </header>
  );
}

function hasSessionTools(room: RoomHeader): boolean {
  return (
    room.scoring !== undefined ||
    room.ticket !== undefined ||
    room.timer !== undefined
  );
}

/**
 * A group of the Menu's controls under a small heading. Not a heading
 * element: the page's h1 is the room's status line, further down, and the
 * Menu comes first in the page. A group named by its words instead, which
 * a screen reader announces on entering it.
 */
function MenuGroup({
  heading,
  children,
}: {
  readonly heading: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="menu-group">
      <p id={id} className="menu-heading">
        {heading}
      </p>
      {children}
    </div>
  );
}

/** Says, on the shared screen too, that this is the facilitator view. */
function FacilitatingPill({ store }: { readonly store: FacilitateStore }) {
  const on = useSyncExternalStore(store.subscribe, store.isOn, store.isOn);
  if (!on) return null;
  return (
    <span className="pill pill--facilitating">{HEADER_COPY.facilitating}</span>
  );
}
