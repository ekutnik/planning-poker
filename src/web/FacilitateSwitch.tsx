import { useId, useSyncExternalStore } from "react";
import { HEADER_COPY } from "./copy.js";
import type { FacilitateStore } from "./facilitate.js";

/**
 * Facilitate, a per-browser view switch, not a role. A real switch
 * (role="switch", aria-checked); its visible label is a <label>, so a click
 * on the word toggles it too.
 */
export function FacilitateSwitch({
  store,
}: {
  readonly store: FacilitateStore;
}) {
  const on = useSyncExternalStore(store.subscribe, store.isOn, store.isOn);
  const id = useId();
  return (
    <div className="menu-row menu-row--switch">
      <div className="menu-text">
        <label htmlFor={id} className="menu-label">
          {HEADER_COPY.facilitate}
        </label>
        <span id={`${id}-note`} className="menu-note">
          {HEADER_COPY.facilitateNote}
        </span>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        className="switch"
        aria-checked={on}
        aria-describedby={`${id}-note`}
        onClick={() => store.set(!on)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}
