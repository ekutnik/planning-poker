import type { ErrorCode } from "../shared/protocol.js";
import type {
  ConnectionState,
  RoomAction,
} from "./connection/room-connection.js";
import { ERROR_COPY } from "./copy.js";

/** The part of RoomConnection a session drives; RoomConnection satisfies it. */
export interface SessionConnection {
  getState(): ConnectionState;
  subscribe(listener: () => void): () => void;
  onServerError(listener: (code: ErrorCode) => void): () => void;
  start(): void;
  restart(): void;
  retryNow(): void;
  send(action: RoomAction): boolean;
  leave(): void;
  dispose(): void;
}

export interface SessionView {
  readonly state: ConnectionState;
  /** Copy for the last server error, until the person's next action. */
  readonly notice: string | null;
}

export interface SessionDeps {
  readonly connect: () => SessionConnection;
  /** Retry at once when the person comes back (online, tab visible). */
  readonly watchReturn: (connection: SessionConnection) => () => void;
}

const BEFORE_CONNECT: SessionView = {
  state: { status: "connecting", attempt: 0, snapshot: null },
  notice: null,
};

/**
 * One room screen's connection lifecycle, for useSyncExternalStore. A
 * connection exists exactly while someone is subscribed: subscribing creates
 * and starts one, unsubscribing disposes it. React's StrictMode subscribes,
 * unsubscribes and subscribes again in development, which here is create,
 * dispose, create: one live socket, without effects or setState in React.
 */
export class RoomSession {
  private connection: SessionConnection | null = null;
  private listener: (() => void) | null = null;
  private view: SessionView = BEFORE_CONNECT;

  constructor(private readonly deps: SessionDeps) {}

  /** Stable: the same object until the state or the notice changes. */
  readonly getSnapshot = (): SessionView => this.view;

  readonly subscribe = (listener: () => void): (() => void) => {
    // Two live connections with one token would supersede each other in a
    // loop. StrictMode's subscribe, unsubscribe, subscribe is sequential, so
    // it never trips this; only a second concurrent subscriber does.
    if (this.connection !== null) {
      throw new Error("RoomSession supports one subscriber at a time");
    }
    const connection = this.deps.connect();
    this.connection = connection;
    this.listener = listener;
    const update = (notice: string | null) => {
      const state = connection.getState();
      if (state === this.view.state && notice === this.view.notice) return;
      this.view = { state, notice };
      listener();
    };
    const stopState = connection.subscribe(() => update(this.view.notice));
    const stopErrors = connection.onServerError((code) => {
      const copy = ERROR_COPY[code];
      if (copy !== null) update(copy);
    });
    const stopWatching = this.deps.watchReturn(connection);
    connection.start();
    return () => {
      stopWatching();
      stopErrors();
      stopState();
      connection.dispose();
      if (this.connection === connection) {
        this.connection = null;
        this.listener = null;
        this.view = BEFORE_CONNECT;
      }
    };
  };

  send(action: RoomAction): void {
    this.clearNotice();
    this.connection?.send(action);
  }

  leave(): void {
    this.connection?.leave();
  }

  /** "Use this tab", "Try again". */
  restart(): void {
    this.clearNotice();
    this.connection?.restart();
  }

  private clearNotice(): void {
    if (this.view.notice === null) return;
    this.view = { ...this.view, notice: null };
    this.listener?.();
  }
}
