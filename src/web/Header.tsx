import type { ThemeStore } from "./theme.js";
import { ThemeMenu } from "./ThemeMenu.js";

/**
 * The same header on every screen. The title is fixed: rooms have no names
 * yet (#35), and the room id must never stand in for one, because it is the
 * room's credential and the facilitator's screen is shared.
 */
export function Header({ theme }: { readonly theme: ThemeStore }) {
  return (
    <header className="app-header">
      <p className="app-title">Planning poker</p>
      <ThemeMenu store={theme} />
    </header>
  );
}
