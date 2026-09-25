import { useId, useSyncExternalStore } from "react";
import type { FacilitateStore } from "./facilitate.js";

/**
 * A per-browser view switch, not a role. The dot is filled when on; the
 * pressed state and the description carry the same meaning in words.
 */
export function FacilitateToggle({
  store,
}: {
  readonly store: FacilitateStore;
}) {
  const on = useSyncExternalStore(store.subscribe, store.isOn);
  const descriptionId = useId();
  return (
    <>
      <button
        type="button"
        className="facilitate-toggle"
        aria-pressed={on}
        aria-describedby={descriptionId}
        onClick={() => store.set(!on)}
      >
        Facilitate <span aria-hidden="true">{on ? "●" : "○"}</span>
      </button>
      <span id={descriptionId} className="visually-hidden">
        Shows the round controls up front and hides your own vote, so you can
        share your screen.
      </span>
    </>
  );
}
