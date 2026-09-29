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
  onNudged(listener: () => void): () => void;
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
  /**
   * Someone nudged you, and it still stands (nudgeEnded): the banner and
   * the tab title show it. Anonymous: nothing here says who (ADR 0007).
   */
  readonly nudged: boolean;
}

export interface SessionDeps {
  readonly connect: () => SessionConnection;
  /** Retry at once when the person comes back (online, tab visible). */
  readonly watchReturn: (connection: SessionConnection) => () => void;
}

const BEFORE_CONNECT: SessionView = {
  state: { status: "connecting", attempt: 0, snapshot: null },
  notice: null,
  nudged: false,
};

/**
 * Whether this state ends a nudge: you have voted, the round is revealed
 * (a reset comes through the reveal), or the connection has stopped. A
 * connection still finding its feet, with no snapshot yet, ends nothing.
 * Leaving ends it too, by ending the session. Once ended, it stays ended
 * until the next nudge, even if you clear your vote.
 */
export function nudgeEnded(state: ConnectionState): boolean {
  if (state.status === "stopped") return true;
  const { snapshot } = state;
  if (snapshot === null) return false;
  if (snapshot.phase !== "voting") return true;
  return (
    snapshot.participants.find((p) => p.id === snapshot.viewerId)?.hasVoted ??
    false
  );
}

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
    const update = (notice: string | null, nudge = false) => {
      const state = connection.getState();
      const nudged = (nudge || this.view.nudged) && !nudgeEnded(state);
      if (
        state === this.view.state &&
        notice === this.view.notice &&
        nudged === this.view.nudged
      ) {
        return;
      }
      this.view = { state, notice, nudged };
      listener();
    };
    const stopState = connection.subscribe(() => update(this.view.notice));
    const stopNudges = connection.onNudged(() =>
      update(this.view.notice, true),
    );
    const stopErrors = connection.onServerError((code) => {
      const copy = ERROR_COPY[code];
      if (copy !== null) update(copy);
    });
    const stopWatching = this.deps.watchReturn(connection);
    connection.start();
    return () => {
      stopWatching();
      stopNudges();
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
