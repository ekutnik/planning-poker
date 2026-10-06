import { describe, expect, it } from "vitest";
import type { ErrorCode } from "../shared/protocol.js";
import type {
  ConnectionState,
  RoomAction,
} from "./connection/room-connection.js";
import { ERROR_COPY } from "./copy.js";
import { RoomSession, type SessionConnection } from "./room-session.js";

class FakeConnection implements SessionConnection {
  state: ConnectionState = { status: "connecting", attempt: 0, snapshot: null };
  started = 0;
  restarted = 0;
  disposed = false;
  left = false;
  readonly sent: RoomAction[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly errorListeners = new Set<(code: ErrorCode) => void>();
  private readonly nudgeListeners = new Set<() => void>();

  getState = () => this.state;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onServerError(listener: (code: ErrorCode) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }
  onNudged(listener: () => void) {
    this.nudgeListeners.add(listener);
    return () => this.nudgeListeners.delete(listener);
  }
  start() {
    this.started += 1;
  }
  restart() {
    this.restarted += 1;
  }
  retryNow() {
    return undefined;
  }
  send(action: RoomAction) {
    this.sent.push(action);
    return true;
  }
  leave() {
    this.left = true;
  }
  dispose() {
    this.disposed = true;
  }
  // Test controls.
  setState(state: ConnectionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  error(code: ErrorCode) {
    for (const listener of this.errorListeners) listener(code);
  }
  nudge() {
    for (const listener of this.nudgeListeners) listener();
  }
  listening() {
    return (
      this.listeners.size + this.errorListeners.size + this.nudgeListeners.size
    );
  }
}

function setup() {
  const connections: FakeConnection[] = [];
  let watching = 0;
  const session = new RoomSession({
    connect: () => {
      const connection = new FakeConnection();
      connections.push(connection);
      return connection;
    },
    watchReturn: () => {
      watching += 1;
      return () => (watching -= 1);
    },
  });
  return { session, connections, watching: () => watching };
}

const STOPPED: ConnectionState = { status: "stopped", reason: "superseded" };

describe("RoomSession", () => {
  it("creates and starts a connection on subscribe, and disposes it on unsubscribe", () => {
    const { session, connections, watching } = setup();
    const unsubscribe = session.subscribe(() => undefined);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.started).toBe(1);
    expect(watching()).toBe(1);

    unsubscribe();
    expect(connections[0]?.disposed).toBe(true);
    expect(connections[0]?.listening()).toBe(0);
    expect(watching()).toBe(0);
  });

  it("leaves one live connection after StrictMode's subscribe, unsubscribe, subscribe", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined)();
    session.subscribe(() => undefined);
    expect(connections.map((c) => c.disposed)).toEqual([true, false]);
    expect(connections[1]?.started).toBe(1);
  });

  it("refuses a second concurrent subscriber, keeping the first connection", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined);
    expect(() => session.subscribe(() => undefined)).toThrow(
      "one subscriber at a time",
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]?.disposed).toBe(false);
  });

  it("returns the same snapshot object until something changes", () => {
    const { session, connections } = setup();
    let renders = 0;
    session.subscribe(() => (renders += 1));
    const before = session.getSnapshot();
    expect(session.getSnapshot()).toBe(before);

    connections[0]?.setState(STOPPED);
    expect(session.getSnapshot()).not.toBe(before);
    expect(session.getSnapshot().state).toBe(STOPPED);
    expect(renders).toBe(1);
  });

  it("shows copy for a server error until the next action, and nothing for handled codes", () => {
    const { session, connections } = setup();
    let renders = 0;
    session.subscribe(() => (renders += 1));
    const connection = connections[0];

    connection?.error("NOT_CONNECTED"); // handled by the UI state: no notice
    expect(session.getSnapshot().notice).toBeNull();
    expect(renders).toBe(0);

    connection?.error("VOTING_CLOSED");
    expect(session.getSnapshot().notice).toBe(ERROR_COPY.VOTING_CLOSED);
    connection?.setState(STOPPED); // other changes keep the notice
    expect(session.getSnapshot().notice).toBe(ERROR_COPY.VOTING_CLOSED);

    session.send({ type: "reset" });
    expect(session.getSnapshot().notice).toBeNull();
    expect(renders).toBe(3); // notice, state change, cleared notice
    expect(connection?.sent).toEqual([{ type: "reset" }]);
  });

  it("passes leave and restart to the live connection", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined);
    session.restart();
    session.leave();
    expect(connections[0]?.restarted).toBe(1);
    expect(connections[0]?.left).toBe(true);
  });
});

/** An open room, voting unless revealed, with you ("me") and Ben. */
function open(youVoted: boolean, phase: "voting" | "revealed" = "voting") {
  const participants = [
    { id: "me", name: "Ada", status: "connected" as const },
    { id: "ben", name: "Ben", status: "connected" as const },
  ];
  const state: ConnectionState = {
    status: "open",
    snapshot:
      phase === "voting"
        ? {
            phase,
            roomId: "abcdefghijk",
            version: 1,
            viewerId: "me",
            ticket: null,
            scores: null,
            timer: {
              durationMs: 60_000,
              state: "idle",
              endsAt: null,
              remainingMs: null,
            },
            yourVote: youVoted ? "5" : null,
            participants: participants.map((p) => ({
              ...p,
              hasVoted: p.id === "me" && youVoted,
            })),
          }
        : {
            phase,
            roomId: "abcdefghijk",
            version: 1,
            viewerId: "me",
            ticket: null,
            scores: null,
            timer: {
              durationMs: 60_000,
              state: "idle",
              endsAt: null,
              remainingMs: null,
            },
            revealCause: null,
            participants: participants.map((p) => ({ ...p, vote: null })),
            results: {
              voteCount: 0,
              distribution: [],
              consensus: false,
              min: null,
              max: null,
              spreadSteps: null,
              winners: [],
            },
          },
  };
  return state;
}

describe("RoomSession: a nudge (ADR 0007)", () => {
  function nudgedSession() {
    const ctx = setup();
    ctx.session.subscribe(() => undefined);
    const connection = ctx.connections[0];
    if (!connection) throw new Error("no connection");
    connection.setState(open(false));
    connection.nudge();
    return { ...ctx, connection };
  }

  it("stands once someone nudges you, through snapshots that change nothing for you", () => {
    const { session, connection } = nudgedSession();
    expect(session.getSnapshot().nudged).toBe(true);
    connection.setState(open(false));
    expect(session.getSnapshot().nudged).toBe(true);
  });

  it("ends when you vote, and stays ended if you clear your vote", () => {
    const { session, connection } = nudgedSession();
    connection.setState(open(true));
    expect(session.getSnapshot().nudged).toBe(false);
    connection.setState(open(false));
    expect(session.getSnapshot().nudged).toBe(false);
  });

  it("ends when the round is revealed, and so for a reset too", () => {
    const { session, connection } = nudgedSession();
    connection.setState(open(false, "revealed"));
    expect(session.getSnapshot().nudged).toBe(false);
    connection.setState(open(false));
    expect(session.getSnapshot().nudged).toBe(false);
  });

  it("ends when the connection stops", () => {
    const { session, connection } = nudgedSession();
    connection.setState(STOPPED);
    expect(session.getSnapshot().nudged).toBe(false);
  });

  it("survives a reconnect that has no snapshot yet", () => {
    const { session, connection } = nudgedSession();
    connection.setState({
      status: "reconnecting",
      attempt: 1,
      retryAt: 0,
      snapshot: null,
    });
    expect(session.getSnapshot().nudged).toBe(true);
  });

  it("does not stand for someone who has already voted", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined);
    connections[0]?.setState(open(true));
    connections[0]?.nudge();
    expect(session.getSnapshot().nudged).toBe(false);
  });

  it("ends with the session: leaving drops it", () => {
    const { session, connections } = setup();
    const stop = session.subscribe(() => undefined);
    connections[0]?.setState(open(false));
    connections[0]?.nudge();
    stop();
    expect(session.getSnapshot().nudged).toBe(false);
    expect(connections[0]?.listening()).toBe(0);
  });
});

describe("RoomSession: a notice raised while joining (ADR 0009)", () => {
  const RECONNECTING: ConnectionState = {
    status: "reconnecting",
    attempt: 1,
    retryAt: 5_000,
    snapshot: null,
  };

  it("goes once the join works: RATE_LIMITED, then 1013, then a successful join", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined);
    const connection = connections[0];
    connection?.error("RATE_LIMITED"); // while joining
    connection?.setState(RECONNECTING); // the 1013, retried
    expect(session.getSnapshot().notice).toBe(ERROR_COPY.RATE_LIMITED);
    connection?.setState(open(false)); // the retry joined
    expect(session.getSnapshot().notice).toBeNull();
  });

  it("goes after a reconnect's join too, not only the first", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined);
    const connection = connections[0];
    connection?.setState(open(false));
    connection?.setState(RECONNECTING);
    connection?.error("RATE_LIMITED");
    connection?.setState(open(false));
    expect(session.getSnapshot().notice).toBeNull();
  });

  it("stays when it was raised after the join, through someone else's vote", () => {
    const { session, connections } = setup();
    session.subscribe(() => undefined);
    const connection = connections[0];
    connection?.setState(open(false));
    connection?.error("RATE_LIMITED"); // your own message refused
    connection?.setState(open(false)); // Ben votes: a new snapshot
    expect(session.getSnapshot().notice).toBe(ERROR_COPY.RATE_LIMITED);
  });
});
