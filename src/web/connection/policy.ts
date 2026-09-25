import { CloseCode } from "../../shared/close-codes.js";

/** Why the client stopped for good: no automatic retry follows any of these. */
export type StopReason =
  | "left"
  | "superseded"
  | "outdated"
  | "room-full"
  | "server-full"
  | "invalid-name";

export type Backoff = "normal" | "long";

export type ClosePolicy =
  | { readonly kind: "stop"; readonly reason: StopReason }
  | { readonly kind: "retry"; readonly backoff: Backoff };

const STOP = (reason: StopReason): ClosePolicy => ({ kind: "stop", reason });
const RETRY = (backoff: Backoff): ClosePolicy => ({ kind: "retry", backoff });

/**
 * What the client does when the server closes its socket (#20). One table
 * instead of conditionals scattered through the client, so every row is
 * tested. An unknown code retries with normal backoff: a close the client
 * does not understand is more likely a network hiccup than a verdict.
 */
const CLOSE_POLICY: ReadonlyMap<number, ClosePolicy> = new Map([
  [1000, STOP("left")], // normal closure: the server confirms our leave
  [CloseCode.SUPERSEDED, STOP("superseded")], // opened in another tab
  [CloseCode.OUTDATED_CLIENT, STOP("outdated")], // a new version is deployed
  [CloseCode.JOIN_TIMEOUT, RETRY("normal")],
  [1001, RETRY("normal")], // going away: the server is restarting
  [1006, RETRY("normal")], // abnormal closure: the connection dropped
  [1008, RETRY("long")], // policy violation (rate limit)
  [1013, RETRY("long")], // try again later: the server is full
]);

export function policyFor(code: number): ClosePolicy {
  return CLOSE_POLICY.get(code) ?? RETRY("normal");
}

/**
 * Full-jitter exponential backoff: a random delay in [0, min(cap, base·2^attempt)).
 * After a server restart every open tab reconnects at once; without the
 * randomness they would retry in lockstep, a thundering herd. Full jitter
 * spreads them across the whole window.
 */
export function backoffDelay(
  attempt: number,
  random: () => number,
  baseMs = 500,
  capMs = 10_000,
): number {
  return Math.floor(random() * Math.min(capMs, baseMs * 2 ** attempt));
}

/** Backoff windows per kind. Long is for a server that asked us to hold off. */
export const BACKOFF: Readonly<
  Record<Backoff, { readonly baseMs: number; readonly capMs: number }>
> = {
  normal: { baseMs: 500, capMs: 10_000 },
  long: { baseMs: 5_000, capMs: 120_000 },
};

/** The client sends an app-level ping this often (#20). */
export const CLIENT_PING_INTERVAL_MS = 20_000;
/** A socket that has not opened after this long is abandoned and retried. */
export const CONNECT_DEADLINE_MS = 10_000;
/** A ping with no reply of any kind after this long means the server is gone. */
export const PONG_DEADLINE_MS = 10_000;
/**
 * How often the connection's one timer runs. It covers the whole lifecycle,
 * connect deadline included, by comparing timestamps, like the server's sweep.
 */
export const LIVENESS_TICK_MS = 5_000;
