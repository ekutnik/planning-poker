import { describe, expect, it } from "vitest";
import { CloseCode } from "../../shared/close-codes.js";
import {
  PROTOCOL_VERSION,
  type ErrorCode,
  type ServerMessage,
} from "../../shared/protocol.js";
import type { RoomSnapshot } from "../../shared/snapshot.js";
import {
  BACKOFF,
  CLIENT_PING_INTERVAL_MS,
  CONNECT_DEADLINE_MS,
  LIVENESS_TICK_MS,
  PONG_DEADLINE_MS,
} from "./policy.js";
import {
  RoomConnection,
  type Clock,
  type Socket,
  type SocketEvents,
} from "./room-connection.js";
import { retryOnReturn } from "./wake.js";

const ROOM = "abcdefghijk";
const TOKEN = "SESSIONTOKEN_ALICE_0001";

/** Timers fire at their due time; stall() moves time without firing, like a throttled tab. */
class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.time;
  }
  setTimeout(run: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, run });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  pending(): number {
    return this.timers.size;
  }
  /** Advances time, firing each timer at its own due time, in order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const next = this.nextDue(end);
      if (!next) break;
      this.time = next.at;
      this.timers.delete(next.id);
      next.run();
    }
    this.time = end;
  }
  /** Jumps time forward without firing, then fires everything now overdue, late. */
  stall(ms: number): void {
    this.time += ms;
    for (;;) {
      const next = this.nextDue(this.time);
      if (!next) break;
      this.timers.delete(next.id);
      next.run();
    }
  }
  private nextDue(limit: number) {
    let best: { id: number; at: number; run: () => void } | undefined;
    for (const [id, timer] of this.timers) {
      if (timer.at <= limit && (!best || timer.at < best.at)) {
        best = { id, ...timer };
      }
    }
    return best;
  }
}

class FakeSocket implements Socket {
  readonly sent: unknown[] = [];
  closedWith: { code: number; reason: string } | null = null;
  constructor(
    readonly path: string,
    private readonly events: SocketEvents,
  ) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
  }
  // The server side of the fake.
  open(): void {
    this.events.onOpen();
  }
  receive(message: ServerMessage | { type: string }): void {
    this.events.onMessage(JSON.stringify(message));
  }
  receiveRaw(data: string): void {
    this.events.onMessage(data);
  }
  serverClose(code: number): void {
    this.events.onClose(code);
  }
}

function snapshot(version: number): RoomSnapshot {
  return {
    phase: "voting",
    roomId: ROOM,
    version,
    viewerId: "viewer",
    yourVote: null,
    participants: [],
  };
}

function setup(random = () => 0.5, failingOpens = 0) {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  let failuresLeft = failingOpens;
  const warnings: Record<string, unknown>[] = [];
  const connection = new RoomConnection(
    ROOM,
    { sessionToken: TOKEN, name: "Alice" },
    {
      openSocket: (path, events) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new SyntaxError(
            "The URL's scheme must be either 'ws' or 'wss'.",
          );
        }
        const socket = new FakeSocket(path, events);
        sockets.push(socket);
        return socket;
      },
      clock,
      random,
      warn: (_message, fields) => warnings.push(fields),
    },
  );
  const latest = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error("no socket opened yet");
    return socket;
  };
  /** Starts, opens the socket and delivers a first snapshot. */
  const joined = (version = 1) => {
    connection.start();
    latest().open();
    latest().receive({ type: "snapshot", snapshot: snapshot(version) });
  };
  return { clock, sockets, warnings, connection, latest, joined };
}

describe("RoomConnection — joining", () => {
  it("sends join on open, and is open only once a snapshot proves the join", () => {
    const { connection, latest } = setup();
    connection.start();
    expect(latest().path).toBe(`/ws/${ROOM}?v=${PROTOCOL_VERSION}`);
    expect(connection.getState()).toMatchObject({ status: "connecting" });

    latest().open();
    expect(latest().sent).toEqual([
      { type: "join", sessionToken: TOKEN, name: "Alice" },
    ]);
    expect(connection.getState()).toMatchObject({ status: "connecting" });

    latest().receive({ type: "snapshot", snapshot: snapshot(1) });
    expect(connection.getState()).toEqual({
      status: "open",
      snapshot: snapshot(1),
    });
  });

  it.each<[ErrorCode, string]>([
    ["ROOM_FULL", "room-full"],
    ["SERVER_FULL", "server-full"],
    ["INVALID_NAME", "invalid-name"],
  ])(
    "stops on %s during join, closes its socket, and never retries",
    (code, reason) => {
      const { connection, latest, sockets, clock } = setup();
      connection.start();
      latest().open();
      latest().receive({ type: "error", code });

      expect(connection.getState()).toEqual({ status: "stopped", reason });
      expect(latest().closedWith?.code).toBe(1000);
      // The server's JOIN_TIMEOUT for that socket arrives later and is ignored.
      latest().serverClose(CloseCode.JOIN_TIMEOUT);
      clock.advance(10 * 60_000);
      expect(sockets).toHaveLength(1);
      expect(connection.getState()).toEqual({ status: "stopped", reason });
    },
  );

  it("treats join-phase codes as join failures only before the join succeeds", () => {
    const { connection, latest, joined } = setup();
    const errors: ErrorCode[] = [];
    connection.onServerError((code) => errors.push(code));
    joined();
    latest().receive({ type: "error", code: "ROOM_FULL" });
    expect(connection.getState()).toMatchObject({ status: "open" });
    expect(errors).toEqual(["ROOM_FULL"]);
  });

  it("passes other errors to listeners without changing state", () => {
    const { connection, latest, joined } = setup();
    const errors: ErrorCode[] = [];
    connection.onServerError((code) => errors.push(code));
    joined();
    latest().receive({ type: "error", code: "VOTING_CLOSED" });
    expect(errors).toEqual(["VOTING_CLOSED"]);
    expect(connection.getState()).toMatchObject({ status: "open" });
  });
});

describe("RoomConnection — close-code policy", () => {
  it.each<[string, number, string]>([
    ["SUPERSEDED", CloseCode.SUPERSEDED, "superseded"],
    ["OUTDATED_CLIENT", CloseCode.OUTDATED_CLIENT, "outdated"],
    ["normal closure", 1000, "left"],
  ])("stops for good on %s", (_name, code, reason) => {
    const { connection, latest, sockets, clock, joined } = setup();
    joined();
    latest().serverClose(code);
    clock.advance(10 * 60_000);
    expect(connection.getState()).toEqual({ status: "stopped", reason });
    expect(sockets).toHaveLength(1); // never reloads or reconnects on its own
  });

  it.each([CloseCode.JOIN_TIMEOUT, 1001, 1006, 4999])(
    "reconnects with normal backoff after %i",
    (code) => {
      const { connection, latest, sockets, clock, joined } = setup(() => 0.999);
      joined();
      latest().serverClose(code);
      expect(connection.getState()).toMatchObject({
        status: "reconnecting",
        attempt: 1,
        retryAt: 499,
      });
      clock.advance(499);
      expect(sockets).toHaveLength(2);
    },
  );

  it.each([1008, 1013])("reconnects with long backoff after %i", (code) => {
    const { connection, latest, clock, joined } = setup(() => 0.999);
    joined();
    latest().serverClose(code);
    const window = BACKOFF.long.baseMs;
    expect(connection.getState()).toMatchObject({
      status: "reconnecting",
      retryAt: Math.floor(0.999 * window),
    });
    clock.advance(window - 1);
    expect(connection.getState()).toMatchObject({ status: "connecting" });
  });
});

describe("RoomConnection — reconnecting", () => {
  it("keeps the last snapshot while reconnecting instead of blanking", () => {
    const { connection, latest, joined } = setup();
    joined(7);
    latest().serverClose(1006);
    expect(connection.getState()).toMatchObject({
      status: "reconnecting",
      snapshot: snapshot(7),
    });
  });

  it("grows the backoff until the cap, and resets it only after a snapshot", () => {
    const { connection, latest, clock, joined } = setup(() => 0.999);
    joined();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      latest().serverClose(1006);
      const state = connection.getState();
      if (state.status !== "reconnecting") throw new Error(state.status);
      delays.push(state.retryAt - clock.now());
      clock.advance(state.retryAt - clock.now());
      latest().open(); // the socket opens, but no snapshot arrives
    }
    expect(delays).toEqual([499, 999, 1998, 3996, 7992, 9990, 9990, 9990]);

    latest().receive({ type: "snapshot", snapshot: snapshot(2) });
    latest().serverClose(1006);
    expect(connection.getState()).toMatchObject({
      attempt: 1,
      retryAt: clock.now() + 499,
    });
  });

  it("ignores every event from a replaced socket", () => {
    const { connection, latest, sockets, clock, joined } = setup();
    joined(3);
    const old = latest();
    old.serverClose(1006);
    clock.advance(BACKOFF.normal.capMs);
    latest().open();
    latest().receive({ type: "snapshot", snapshot: snapshot(4) });

    old.receive({ type: "snapshot", snapshot: snapshot(99) });
    old.serverClose(CloseCode.SUPERSEDED);
    old.open();
    expect(connection.getState()).toEqual({
      status: "open",
      snapshot: snapshot(4),
    });
    expect(sockets).toHaveLength(2);
    expect(old.sent).toHaveLength(1); // only its own join
  });

  it("accepts a lower version on a new socket: a server restart starts at 1", () => {
    const { connection, latest, clock, warnings, joined } = setup();
    joined(57);
    latest().serverClose(1001); // the server restarts
    clock.advance(BACKOFF.normal.capMs);
    latest().open();
    latest().receive({ type: "snapshot", snapshot: snapshot(1) });
    expect(connection.getState()).toEqual({
      status: "open",
      snapshot: snapshot(1),
    });
    expect(warnings).toEqual([]);
  });

  it("warns when the version goes backwards on one socket, a server bug", () => {
    const { connection, latest, warnings, joined } = setup();
    joined(5);
    latest().receive({ type: "snapshot", snapshot: snapshot(3) });
    expect(warnings).toEqual([{ from: 5, to: 3 }]);
    expect(connection.getState()).toMatchObject({ snapshot: snapshot(3) });
  });

  it("ignores unknown server message types and malformed frames", () => {
    const { connection, latest, joined } = setup();
    joined(1);
    const before = connection.getState();
    latest().receive({ type: "confetti" });
    latest().receiveRaw("{not json");
    latest().receiveRaw("42");
    expect(connection.getState()).toBe(before);
  });

  it("retries at once when the browser comes back, but not during a long backoff", () => {
    const { connection, latest, sockets, joined } = setup(() => 0.999);
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    const stopWatching = retryOnReturn(connection, win, doc);
    joined();

    latest().serverClose(1006);
    win.dispatchEvent(new Event("online"));
    expect(sockets).toHaveLength(2);

    latest().serverClose(1006);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(sockets).toHaveLength(3);

    latest().serverClose(1013); // the server asked us to hold off
    win.dispatchEvent(new Event("online"));
    expect(sockets).toHaveLength(3);

    stopWatching();
  });
});

describe("RoomConnection — liveness", () => {
  it("pings every CLIENT_PING_INTERVAL_MS, and any message answers it", () => {
    const { latest, clock, joined } = setup();
    joined();
    clock.advance(CLIENT_PING_INTERVAL_MS);
    expect(latest().sent.at(-1)).toEqual({ type: "ping" });

    // A broadcast counts as a reply as well as a pong would. Stop short of
    // the next ping, which would need its own reply.
    latest().receive({ type: "snapshot", snapshot: snapshot(2) });
    clock.advance(PONG_DEADLINE_MS + LIVENESS_TICK_MS);
    expect(latest().closedWith).toBeNull();
  });

  it("reconnects when a ping gets no reply within PONG_DEADLINE_MS", () => {
    const { connection, latest, sockets, clock, joined } = setup(() => 0.999);
    joined();
    const silent = latest();
    clock.advance(CLIENT_PING_INTERVAL_MS); // ping sent at 20s, never answered
    clock.advance(PONG_DEADLINE_MS - 1);
    expect(silent.closedWith).toBeNull(); // still within the deadline

    clock.advance(1); // the tick at 30s: exactly PONG_DEADLINE_MS after the ping
    expect(silent.closedWith).toEqual({
      code: 1000,
      reason: "no reply to ping",
    });
    expect(connection.getState()).toMatchObject({ status: "reconnecting" });
    clock.advance(BACKOFF.normal.baseMs);
    expect(sockets).toHaveLength(2);
  });

  it("does not reconnect when a tick runs 60s late and the pong already came", () => {
    const { connection, latest, joined, clock } = setup();
    joined();
    clock.advance(CLIENT_PING_INTERVAL_MS); // ping sent
    latest().receive({ type: "pong" }); // answered promptly

    clock.stall(60_000); // background tab: the next tick runs a minute late
    expect(latest().closedWith).toBeNull();
    expect(connection.getState()).toMatchObject({ status: "open" });
  });

  it("stays quiet in a background tab whose only traffic is its own pongs", () => {
    const { connection, latest, joined, clock } = setup();
    joined();
    for (let minute = 0; minute < 30; minute++) {
      clock.stall(60_000); // one throttled tick a minute
      const last = latest().sent.at(-1) as { type: string };
      if (last.type === "ping") latest().receive({ type: "pong" });
    }
    expect(latest().closedWith).toBeNull();
    expect(connection.getState()).toMatchObject({ status: "open" });
  });
});

describe("RoomConnection — no state waits forever", () => {
  it("retries a socket that never opens once CONNECT_DEADLINE_MS passes", () => {
    const { connection, latest, sockets, clock } = setup(() => 0.999);
    connection.start();
    const hung = latest(); // neither open nor close ever arrives
    clock.advance(CONNECT_DEADLINE_MS - 1);
    expect(hung.closedWith).toBeNull();
    expect(connection.getState()).toMatchObject({ status: "connecting" });

    clock.advance(1); // the tick at 10s: exactly the deadline
    expect(hung.closedWith).toEqual({ code: 1000, reason: "connect timeout" });
    expect(connection.getState()).toMatchObject({ status: "reconnecting" });
    clock.advance(BACKOFF.normal.baseMs);
    expect(sockets).toHaveLength(2);
  });

  it("retries when opening a socket throws, and the next attempt succeeds", () => {
    const { connection, latest, sockets, clock, warnings } = setup(
      () => 0.999,
      1,
    );
    connection.start(); // throws inside connect()
    expect(connection.getState()).toMatchObject({
      status: "reconnecting",
      attempt: 1,
    });
    expect(warnings).toEqual([
      { error: "SyntaxError: The URL's scheme must be either 'ws' or 'wss'." },
    ]);

    clock.advance(BACKOFF.normal.baseMs);
    expect(sockets).toHaveLength(1);
    latest().open();
    latest().receive({ type: "snapshot", snapshot: snapshot(1) });
    expect(connection.getState()).toMatchObject({ status: "open" });
  });

  it("keeps exactly one timer pending in every state short of stopped", () => {
    const { connection, latest, clock } = setup();
    connection.start();
    expect(clock.pending()).toBe(1); // connecting: the connect deadline
    latest().open();
    expect(clock.pending()).toBe(1); // open, not joined: liveness
    latest().receive({ type: "snapshot", snapshot: snapshot(1) });
    clock.advance(CLIENT_PING_INTERVAL_MS * 3);
    latest().receive({ type: "pong" });
    expect(clock.pending()).toBe(1); // joined: still one tick, not a second chain
    latest().serverClose(1006);
    expect(clock.pending()).toBe(1); // reconnecting: the retry timer
    connection.leave();
    expect(clock.pending()).toBe(0); // stopped: nothing left to fire
  });
});

describe("RoomConnection — sending and leaving", () => {
  it("sends room actions only while open", () => {
    const { connection, latest } = setup();
    connection.start();
    expect(connection.send({ type: "reveal" })).toBe(false);
    latest().open();
    expect(connection.send({ type: "reveal" })).toBe(false); // not joined yet
    latest().receive({ type: "snapshot", snapshot: snapshot(1) });
    expect(connection.send({ type: "castVote", card: "5" })).toBe(true);
    expect(latest().sent.at(-1)).toEqual({ type: "castVote", card: "5" });
  });

  it("leave() tells the server, stops, and never retries", () => {
    const { connection, latest, sockets, clock, joined } = setup();
    joined();
    connection.leave();
    expect(latest().sent.at(-1)).toEqual({ type: "leave" });
    expect(latest().closedWith?.code).toBe(1000);
    expect(connection.getState()).toEqual({
      status: "stopped",
      reason: "left",
    });

    latest().serverClose(1006); // whatever the old socket reports is ignored
    clock.advance(10 * 60_000);
    expect(sockets).toHaveLength(1);
  });

  it("leave() while reconnecting cancels the pending retry", () => {
    const { connection, latest, sockets, clock, joined } = setup();
    joined();
    latest().serverClose(1006);
    connection.leave();
    clock.advance(10 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(connection.getState()).toEqual({
      status: "stopped",
      reason: "left",
    });
  });

  it("restart() reconnects from a stopped state, for 'Use this tab'", () => {
    const { connection, latest, sockets, joined } = setup();
    joined();
    latest().serverClose(CloseCode.SUPERSEDED);
    connection.restart();
    expect(sockets).toHaveLength(2);
    expect(connection.getState()).toMatchObject({
      status: "connecting",
      attempt: 0,
    });
  });
});
