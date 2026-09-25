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

  getState = () => this.state;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onServerError(listener: (code: ErrorCode) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
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
  listening() {
    return this.listeners.size + this.errorListeners.size;
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
