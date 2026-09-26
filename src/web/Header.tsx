import { useSyncExternalStore } from "react";
import { HEADER_COPY, PRODUCT_NAME } from "./copy.js";
import { CopyLinkButton } from "./CopyLinkButton.js";
import type { FacilitateStore } from "./facilitate.js";
import { FacilitateSwitch } from "./FacilitateSwitch.js";
import { HeaderMenu } from "./HeaderMenu.js";
import { useWide } from "./layout.js";
import { Mark } from "./Mark.js";
import type { ThemeStore } from "./theme.js";
import { ThemeMenu } from "./ThemeMenu.js";

/** What the header adds inside a room. */
export interface RoomHeader {
  readonly facilitate: FacilitateStore;
  /** The room's own link, copied but never shown: it is the credential. */
  readonly link: string;
  readonly onLeave: () => void;
}

/**
 * The same header on every screen: the mark and the product's name, then
 * the controls. The title is fixed: rooms have no names yet (#35), and the
 * room id must never stand in for one, because it is the room's credential
 * and the facilitator's screen is shared. In a room: the Facilitating pill
 * (only while on), Copy link, and a Menu with Facilitate, Theme and Leave
 * the room. Elsewhere the Menu holds Theme alone.
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
          {room && <FacilitateSwitch store={room.facilitate} />}
          <ThemeMenu store={theme} />
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

/** Says, on the shared screen too, that this is the facilitator view. */
function FacilitatingPill({ store }: { readonly store: FacilitateStore }) {
  const on = useSyncExternalStore(store.subscribe, store.isOn, store.isOn);
  if (!on) return null;
  return (
    <span className="pill pill--facilitating">{HEADER_COPY.facilitating}</span>
  );
}
