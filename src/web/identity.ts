import { SESSION_TOKEN_PATTERN, validName } from "../shared/rules.js";
import { safeStorage, type KeyValueStore } from "./storage.js";

export type { KeyValueStore };

const TOKEN_KEY = "planning-poker:token";
const NAME_KEY = "planning-poker:name";

export interface Identity {
  /** One token for every room: the server salts the public id per room (ADR 0006). */
  readonly sessionToken: string;
  /** False when storage is unavailable: the app works, but a reload loses the seat. */
  readonly persistent: boolean;
  /** The last name used, if one was stored and is still valid. */
  lastName(): string | null;
  rememberName(name: string): void;
}

/**
 * The browser's identity for every room. When storage fails (see
 * safeStorage), both the token and the name fall back to memory.
 */
export function loadIdentity(
  getStorage: () => KeyValueStore,
  newToken: () => string,
): Identity {
  const { read, write } = safeStorage(getStorage);

  let sessionToken = read(TOKEN_KEY);
  let persistent = true;
  // A malformed stored token would be refused at join with INVALID_MESSAGE,
  // which is not a join-phase error: the client would wait for JOIN_TIMEOUT
  // and retry forever. Replace it rather than trust it.
  if (sessionToken === null || !SESSION_TOKEN_PATTERN.test(sessionToken)) {
    sessionToken = newToken();
    persistent = write(TOKEN_KEY, sessionToken);
  }

  let rememberedName: string | null = null;
  return {
    sessionToken,
    persistent,
    lastName: () => {
      const name = rememberedName ?? read(NAME_KEY);
      return name === null ? null : validName(name);
    },
    rememberName: (name) => {
      rememberedName = name;
      write(NAME_KEY, name);
    },
  };
}

/**
 * A new session token. crypto.randomUUID() exists only in secure contexts
 * (https or localhost), so opening the dev server from a phone over plain
 * http would lack it; getRandomValues works everywhere.
 */
export function newToken(
  source: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string },
): string {
  if (typeof source.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
