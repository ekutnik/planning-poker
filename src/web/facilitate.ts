import { safeStorage, type KeyValueStore } from "./storage.js";

/**
 * ":v2" since v0.2.1, when the default became off. Until then the landing
 * page saved "on" for everyone who created a room, so the old key would keep
 * them all in the facilitator view; a new key starts everyone from off.
 */
export const FACILITATE_KEY = "planning-poker:facilitate:v2";

/** Function properties, so they can be handed to useSyncExternalStore detached. */
export interface FacilitateStore {
  readonly isOn: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (on: boolean) => void;
}

/**
 * The facilitator view, remembered per browser, because the same person
 * usually runs every session. Off until someone turns it on: most people in
 * a room aren't facilitating. A view, not a role: the server never knows.
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
