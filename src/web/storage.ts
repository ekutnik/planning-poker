/** The part of Storage this uses; localStorage in the browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Function properties, so they can be destructured. */
export interface SafeStorage {
  readonly read: (key: string) => string | null;
  /** False when the value could not be kept (no storage, or a failed write). */
  readonly write: (key: string, value: string) => boolean;
}

/**
 * localStorage that never throws. It fails two ways: accessing it throws in
 * some privacy modes, and setItem throws when storage is full or read-only.
 * Either way the app carries on without persistence.
 */
export function safeStorage(getStorage: () => KeyValueStore): SafeStorage {
  let storage: KeyValueStore | null;
  try {
    storage = getStorage();
  } catch {
    storage = null;
  }
  return {
    read: (key) => {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write: (key, value) => {
      try {
        storage?.setItem(key, value);
        return storage !== null;
      } catch {
        return false;
      }
    },
  };
}
