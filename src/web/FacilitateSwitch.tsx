import { useSyncExternalStore } from "react";
import { HEADER_COPY } from "./copy.js";
import type { FacilitateStore } from "./facilitate.js";
import { SwitchRow } from "./SwitchRow.js";

/** Facilitate in the Menu: a per-browser view switch, not a role. */
export function FacilitateSwitch({
  store,
}: {
  readonly store: FacilitateStore;
}) {
  const on = useSyncExternalStore(store.subscribe, store.isOn, store.isOn);
  return (
    <SwitchRow
      label={HEADER_COPY.facilitate}
      note={HEADER_COPY.facilitateNote}
      checked={on}
      onChange={store.set}
    />
  );
}
