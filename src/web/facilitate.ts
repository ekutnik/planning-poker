import { safeStorage, type KeyValueStore } from "./storage.js";

export const FACILITATE_KEY = "planning-poker:facilitate";

/** Function properties, so they can be handed to useSyncExternalStore detached. */
export interface FacilitateStore {
  readonly isOn: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (on: boolean) => void;
}

/**
 * The facilitator view, remembered per browser, because the same person
 * usually runs every session. A view, not a role: the server never knows.
 */
export function createFacilitateStore(
  getStorage: () => KeyValueStore,
): FacilitateStore {
  const storage = safeStorage(getStorage);
  const listeners = new Set<() => void>();
  let on = storage.read(FACILITATE_KEY) === "on";
  return {
    isOn: () => on,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next === on) return;
      on = next;
      storage.write(FACILITATE_KEY, next ? "on" : "off");
      for (const listener of listeners) listener();
    },
  };
}
