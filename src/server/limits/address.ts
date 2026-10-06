import { KeyedLimiter, MAX_KEYS, type Take } from "./keyed.js";

const MINUTE = 60_000;

export interface AddressLimitSettings {
  /** WebSocket upgrades per address a minute; room ids from the API too. */
  readonly connectsPerMinute: number;
  /** Sockets open at once per address. */
  readonly socketsPerAddress: number;
}

/**
 * The limits per client address that the transport enforces (ADR 0009),
 * by limitKey(): upgrades and the room-id API, each a bucket per key, and
 * the sockets each key has open. Room creation is counted in the room
 * service, which is where a room is created.
 *
 * The open-socket count must never leak: a missed decrement locks an
 * office out until the process restarts. So it changes in two places only,
 * open() just before the service gets the socket, and close() from that
 * socket's own "close" event, which ws fires exactly once, whatever closed
 * it.
 */
export class AddressLimits {
  private readonly upgrades: KeyedLimiter;
  private readonly roomIds: KeyedLimiter;
  private readonly sockets = new Map<string, number>();

  constructor(private readonly settings: AddressLimitSettings) {
    this.upgrades = new KeyedLimiter(settings.connectsPerMinute, MINUTE);
    this.roomIds = new KeyedLimiter(settings.connectsPerMinute, MINUTE);
  }

  /** One WebSocket upgrade from `key`. */
  upgrade(key: string, now: number): Take {
    return this.upgrades.take(key, now);
  }

  /** One room id from the API for `key`, and how long to wait if not. */
  roomId(key: string, now: number): { take: Take; retryAfterMs: number } {
    const take = this.roomIds.take(key, now);
    return {
      take,
      retryAfterMs:
        take === "ok"
          ? 0
          : take === "full"
            ? MINUTE
            : this.roomIds.retryAfterMs(key, now),
    };
  }

  /** Whether `key` may open one more socket now. */
  roomForSocket(key: string): Take {
    const open = this.sockets.get(key);
    if (open === undefined && this.sockets.size >= MAX_KEYS) return "full";
    return (open ?? 0) < this.settings.socketsPerAddress ? "ok" : "limited";
  }

  /** A socket from `key` is about to be handed to the room service. */
  open(key: string): void {
    this.sockets.set(key, (this.sockets.get(key) ?? 0) + 1);
  }

  /** That socket has closed. */
  close(key: string): void {
    const open = (this.sockets.get(key) ?? 0) - 1;
    if (open > 0) this.sockets.set(key, open);
    else this.sockets.delete(key);
  }

  /** Drops buckets that are full again, but never a key with sockets open. */
  sweep(now: number): void {
    const busy = (key: string) => this.sockets.has(key);
    this.upgrades.sweep(now, busy);
    this.roomIds.sweep(now, busy);
  }

  /** For the counts line and the leak tests. */
  bookkeeping(): { sockets: number; keys: number } {
    let sockets = 0;
    for (const open of this.sockets.values()) sockets += open;
    return {
      sockets,
      keys: this.upgrades.size + this.roomIds.size + this.sockets.size,
    };
  }
}
