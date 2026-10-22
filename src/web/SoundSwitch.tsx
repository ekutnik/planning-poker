import { useSyncExternalStore } from "react";
import { HEADER_COPY } from "./copy.js";
import type { SoundStore } from "./sound.js";
import { SwitchRow } from "./SwitchRow.js";

/** Sound in the Menu: whether a nudge plays its chime, in this browser. */
export function SoundSwitch({ store }: { readonly store: SoundStore }) {
  const on = useSyncExternalStore(store.subscribe, store.isOn, store.isOn);
  return (
    <SwitchRow
      label={HEADER_COPY.sound}
      note={HEADER_COPY.soundNote}
      checked={on}
      onChange={store.set}
    />
  );
}
