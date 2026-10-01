import { safeStorage, type KeyValueStore } from "./storage.js";

export const TOOLS_KEY = "planning-poker:tools:v1";

/** The Menu's Session tools that belong to this browser. */
export interface Tools {
  readonly ticket: boolean;
  readonly timer: boolean;
}

export type Tool = keyof Tools;

const OFF: Tools = { ticket: false, timer: false };

/** Function properties, so they can be handed to useSyncExternalStore detached. */
export interface ToolsStore {
  /** The same object until something changes, as useSyncExternalStore needs. */
  readonly get: () => Tools;
  readonly subscribe: (listener: () => void) => () => void;
  readonly set: (tool: Tool, on: boolean) => void;
}

/**
 * What a stored value says: each tool on only if it is exactly true there.
 * Anything else, a value from a later version or none at all, is off.
 */
export function parseTools(stored: string | null): Tools {
  if (stored === null) return OFF;
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== "object" || value === null) return OFF;
    const { ticket, timer } = value as Record<string, unknown>;
    return { ticket: ticket === true, timer: timer === true };
  } catch {
    return OFF;
  }
}

/**
 * Ticket and Timer, remembered per browser like Facilitate, and off until
 * this browser turns them on. They decide only which controls the
 * facilitator view shows: a ticket or a running timer reaches everyone
 * whatever their own settings say. The server never knows them.
 */
export function createToolsStore(getStorage: () => KeyValueStore): ToolsStore {
  const storage = safeStorage(getStorage);
  const listeners = new Set<() => void>();
  let tools = parseTools(storage.read(TOOLS_KEY));
  return {
    get: () => tools,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (tool, on) => {
      if (tools[tool] === on) return;
      tools = { ...tools, [tool]: on };
      storage.write(TOOLS_KEY, JSON.stringify(tools));
      for (const listener of listeners) listener();
    },
  };
}
