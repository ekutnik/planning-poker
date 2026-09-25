import type { ReactNode } from "react";
import type { FacilitateStore } from "./facilitate.js";
import { FacilitateToggle } from "./FacilitateToggle.js";
import type { ThemeStore } from "./theme.js";
import { ThemeMenu } from "./ThemeMenu.js";

/**
 * The same header on every screen; the room adds Facilitate and its actions.
 * The title is fixed: rooms have no names yet (#35), and the room id must
 * never stand in for one, because it is the room's credential and the
 * facilitator's screen is shared. One order in both layouts, so focus order
 * follows what the eye sees.
 */
export function Header({
  theme,
  facilitate,
  actions,
}: {
  readonly theme: ThemeStore;
  readonly facilitate?: FacilitateStore;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="app-header">
      <p className="app-title">Planning poker</p>
      <div className="header-controls">
        {facilitate && <FacilitateToggle store={facilitate} />}
        <ThemeMenu store={theme} />
        {actions}
      </div>
    </header>
  );
}
