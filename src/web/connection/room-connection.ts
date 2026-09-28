import type { ErrorCode, ServerMessage } from "../../shared/protocol.js";
import type { ClientMessage } from "../../shared/protocol.js";
import { socketPath } from "../../shared/socket.js";
import type { RoomSnapshot } from "../../shared/snapshot.js";
import {
  BACKOFF,
  backoffDelay,
  CLIENT_PING_INTERVAL_MS,
  CONNECT_DEADLINE_MS,
  LIVENESS_TICK_MS,
  policyFor,
  PONG_DEADLINE_MS,
  type Backoff,
  type StopReason,
} from "./policy.js";

export type ConnectionState =
  | {
      readonly status: "connecting";
      readonly attempt: number;
      readonly snapshot: RoomSnapshot | null;
    }
  | { readonly status: "open"; readonly snapshot: RoomSnapshot }
  | {
      readonly status: "reconnecting";
      readonly attempt: number;
      readonly retryAt: number;
      readonly snapshot: RoomSnapshot | null;
    }
  | { readonly status: "stopped"; readonly reason: StopReason };

/** What a socket reports. Never called synchronously from openSocket(). */
export interface SocketEvents {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(code: number): void;
}

/** A socket as RoomConnection uses it. The browser adapter wraps WebSocket. */
export interface Socket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export interface ConnectionDeps {
  readonly openSocket: (path: string, events: SocketEvents) => Socket;
  readonly clock: Clock;
  readonly random: () => number;
  readonly warn?: (message: string, fields: Record<string, unknown>) => void;
}

export interface Identity {
  readonly sessionToken: string;
  readonly name: string;
}

/** What the UI may send. join, ping and leave belong to the connection itself. */
export type RoomAction = Exclude<
  ClientMessage,
  { type: "join" | "ping" | "leave" }
>;

/**
 * Errors that mean the join itself failed: stop, never retry into a loop. An
 * unjoined socket would otherwise sit until JOIN_TIMEOUT, which retries the
 * same join forever. INVALID_MESSAGE covers every cause of a join frame the
 * server cannot parse (a malformed token, an over-long name, an outdated
 * shape), not only the ones we have thought of.
 */
const JOIN_PHASE_ERRORS: Partial<Record<ErrorCode, StopReason>> = {
  ROOM_FULL: "room-full",
  SERVER_FULL: "server-full",
  INVALID_NAME: "invalid-name",
  INVALID_MESSAGE: "join-rejected",
};

/**
 * One room's connection, with no framework in it: React only subscribes. It
 * reconnects with full-jitter backoff according to the close-code policy,
 * keeps the last snapshot on screen while it does, and stops for good when a
 * close or a join-phase error says retrying cannot help.
 *
 * Stale data across reconnects is prevented by ignoring every event from a
 * socket that is no longer current, not by comparing snapshot versions: a
 * server restart starts a room again at version 1 (ADR 0003).
 *
 * Liveness (#20) measures silence from the last ping sent, never from the
 * wall clock alone. A pause in this tab's own execution (background tabs
 * throttle timers to about once a minute) must never count as evidence
 * against the server: a late tick finds the pong already arrived, so
 * throttling can only delay detection, never cause it.
 *
 * Every state short of stopped has exactly one timer that can move it on:
 * the retry timer while reconnecting, and otherwise one tick that enforces a
 * connect deadline until the socket opens and liveness after. No state can
 * wait forever on an event that never comes.
 */
export class RoomConnection {
  private state: ConnectionState = {
    status: "connecting",
    attempt: 0,
    snapshot: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly errorListeners = new Set<(code: ErrorCode) => void>();
  private readonly nudgeListeners = new Set<() => void>();

  // The current socket and what is scoped to it. Every socket's events carry
  // the generation they were opened with; older generations are ignored.
  private socket: Socket | null = null;
  private generation = 0;
  private joined = false; // a snapshot has arrived on the current socket
  private lastVersion: number | null = null; // compared within one socket only
  private connectStartedAt = 0;
  private openedAt: number | null = null; // null until the socket opens
  private lastHeardAt = 0;
  private pingSentAt: number | null = null;
  private livenessTimer: number | null = null;

  // Kept across sockets.
  private snapshot: RoomSnapshot | null = null;
  private attempt = 0; // consecutive failed connections since the last snapshot
  private backoff: Backoff = "normal"; // of the pending retry
  private retryTimer: number | null = null;
  private disposed = false;

  constructor(
    private readonly roomId: string,
    private readonly identity: Identity,
    private readonly deps: ConnectionDeps,
  ) {}

  /** For useSyncExternalStore: returns the same object until the state changes. */
  readonly getState = (): ConnectionState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Server errors that are not join-phase failures (e.g. VOTING_CLOSED). */
  onServerError(listener: (code: ErrorCode) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Someone nudged this person (ADR 0007). The message says nothing more. */
  onNudged(listener: () => void): () => void {
    this.nudgeListeners.add(listener);
    return () => this.nudgeListeners.delete(listener);
  }

  start(): void {
    if (this.disposed || this.socket || this.retryTimer !== null) return;
    if (this.state.status === "stopped") return;
    this.connect();
  }

  /** From a stopped state, for "Use this tab" and "Try again". */
  restart(): void {
    if (this.disposed || this.state.status !== "stopped") return;
    this.attempt = 0;
    this.connect();
  }

  /** Sends a room action if joined. No outbox: the snapshot shows what landed. */
  send(action: RoomAction): boolean {
    if (this.state.status !== "open" || !this.socket) return false;
    this.socket.send(JSON.stringify(action));
    return true;
  }

  /**
   * Tears down without telling the server, for unmount and navigation: the
   * server sees the socket close and starts the grace period, so coming back
   * soon reclaims the seat. Clears every timer and listener; the connection
   * cannot be used again. React's StrictMode runs this on every mount in
   * development, so a leaked timer or socket shows up as a duplicate join.
   */
  dispose(): void {
    this.disposed = true;
    this.abandonSocket("dispose");
    this.listeners.clear();
    this.errorListeners.clear();
    this.nudgeListeners.clear();
  }

  leave(): void {
    if (this.state.status === "stopped") return;
    if (this.state.status === "open") {
      this.socket?.send(JSON.stringify({ type: "leave" }));
    }
    this.stop("left");
  }

  /**
   * Skips the rest of a normal backoff, when the browser comes back online or
   * the tab becomes visible. A long backoff is the server asking us to hold
   * off, so it is not cut short.
   */
  retryNow(): void {
    if (this.state.status !== "reconnecting" || this.backoff !== "normal") {
      return;
    }
    this.connect();
  }

  private connect(): void {
    this.clearTimers();
    const generation = ++this.generation;
    this.joined = false;
    this.lastVersion = null;
    this.openedAt = null;
    this.pingSentAt = null;
    this.connectStartedAt = this.deps.clock.now();
    this.setState({
      status: "connecting",
      attempt: this.attempt,
      snapshot: this.snapshot,
    });
    const current = () => generation === this.generation;
    try {
      this.socket = this.deps.openSocket(socketPath(this.roomId), {
        onOpen: () => {
          if (current()) this.handleOpen();
        },
        onMessage: (data) => {
          if (current()) this.handleMessage(data);
        },
        onClose: (code) => {
          if (current()) this.handleClose(code);
        },
      });
    } catch (error) {
      // new WebSocket() throws synchronously on a malformed URL, or on ws:
      // from an https page. This may run inside the retry timer, so a throw
      // would escape uncaught and leave no timer to move the client on.
      this.deps.warn?.("could not open a socket", { error: String(error) });
      this.scheduleRetry("normal");
      return;
    }
    // One timer for the whole lifecycle: the connect deadline until the
    // socket opens, liveness after.
    this.scheduleTick();
  }

  private handleOpen(): void {
    const { sessionToken, name } = this.identity;
    this.socket?.send(JSON.stringify({ type: "join", sessionToken, name }));
    this.openedAt = this.lastHeardAt = this.deps.clock.now();
  }

  private handleMessage(data: string): void {
    this.lastHeardAt = this.deps.clock.now(); // any message proves liveness
    const message = parseServerMessage(data);
    if (!message) return; // unknown types are ignored (forward compatibility)
    switch (message.type) {
      case "snapshot":
        this.handleSnapshot(message.snapshot);
        return;
      case "error":
        this.handleError(message.code);
        return;
      case "pong":
        return;
      case "nudged":
        for (const listener of this.nudgeListeners) listener();
        return;
    }
  }

  private handleSnapshot(snapshot: RoomSnapshot): void {
    // TCP orders one socket's messages, so a decrease here is a server bug.
    // Across sockets versions mean nothing: a restart starts again at 1.
    if (this.lastVersion !== null && snapshot.version < this.lastVersion) {
      this.deps.warn?.("snapshot version went backwards on one socket", {
        from: this.lastVersion,
        to: snapshot.version,
      });
    }
    this.lastVersion = snapshot.version;
    this.joined = true;
    this.attempt = 0; // only a snapshot proves the join worked
    this.snapshot = snapshot;
    this.setState({ status: "open", snapshot });
  }

  private handleError(code: ErrorCode): void {
    const reason = this.joined ? undefined : JOIN_PHASE_ERRORS[code];
    if (reason) {
      // A rejected join frame is our bug, not the person's: report it.
      if (reason === "join-rejected") {
        this.deps.warn?.("the server rejected our join message", { code });
      }
      // Staying unjoined would end in JOIN_TIMEOUT, which retries: a loop.
      this.stop(reason);
      return;
    }
    for (const listener of this.errorListeners) listener(code);
  }

  private handleClose(code: number): void {
    this.socket = null;
    this.clearTimers();
    const policy = policyFor(code);
    if (policy.kind === "stop") {
      this.stop(policy.reason);
      return;
    }
    this.scheduleRetry(policy.backoff);
  }

  private tick(): void {
    this.livenessTimer = null;
    if (!this.socket) return;
    const now = this.deps.clock.now();
    const { openedAt, pingSentAt } = this;
    if (openedAt === null) {
      // Browsers have no connect timeout, and a black-holed path, a captive
      // portal or a cell handover can leave a socket neither open nor closed.
      if (now - this.connectStartedAt >= CONNECT_DEADLINE_MS) {
        this.abandonSocket("connect timeout");
        this.scheduleRetry("normal");
        return;
      }
      this.scheduleTick();
      return;
    }
    const outstanding = pingSentAt !== null && this.lastHeardAt < pingSentAt;
    if (outstanding && now - pingSentAt >= PONG_DEADLINE_MS) {
      // No reply of any kind to our ping: the server or the path is gone.
      this.abandonSocket("no reply to ping");
      this.scheduleRetry("normal");
      return;
    }
    const lastPing = pingSentAt ?? openedAt;
    if (!outstanding && now - lastPing >= CLIENT_PING_INTERVAL_MS) {
      this.socket.send(JSON.stringify({ type: "ping" }));
      this.pingSentAt = now;
    }
    this.scheduleTick();
  }

  private scheduleTick(): void {
    this.livenessTimer = this.deps.clock.setTimeout(
      () => this.tick(),
      LIVENESS_TICK_MS,
    );
  }

  private scheduleRetry(backoff: Backoff): void {
    this.attempt += 1;
    const { baseMs, capMs } = BACKOFF[backoff];
    const delay = backoffDelay(
      this.attempt - 1,
      this.deps.random,
      baseMs,
      capMs,
    );
    this.backoff = backoff;
    this.retryTimer = this.deps.clock.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.setState({
      status: "reconnecting",
      attempt: this.attempt,
      retryAt: this.deps.clock.now() + delay,
      snapshot: this.snapshot,
    });
  }

  private stop(reason: StopReason): void {
    this.abandonSocket(reason);
    this.setState({ status: "stopped", reason });
  }

  /** Unbind before close, so the old socket's close event is ignored. */
  private abandonSocket(reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.generation += 1;
    this.clearTimers();
    socket?.close(1000, reason);
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) this.deps.clock.clearTimeout(this.retryTimer);
    if (this.livenessTimer !== null) {
      this.deps.clock.clearTimeout(this.livenessTimer);
    }
    this.retryTimer = this.livenessTimer = null;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The server is our own code, deployed together, so its messages are trusted
 * for shape (outbound is TypeScript only). Only the type is checked, so an
 * unknown type from a newer server is ignored rather than mishandled.
 */
function parseServerMessage(data: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { type } = value as { type?: unknown };
  const known =
    type === "snapshot" ||
    type === "error" ||
    type === "pong" ||
    type === "nudged";
  return known ? (value as ServerMessage) : null;
}
