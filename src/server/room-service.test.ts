import { describe, expect, it } from "vitest";
import { CloseCode } from "../shared/close-codes.js";
import type { ServerMessage } from "../shared/protocol.js";
import { roomLogId } from "./identity.js";
import type { Connection, Limits, RoomLog } from "./room-service.js";
import {
  JOIN_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  RoomService,
} from "./room-service.js";

const ROOM = "abcdefghijk";
const ALICE = "SESSIONTOKEN_ALICE_0001";
const BOB = "SESSIONTOKEN_BOB_0000001";

class FakeConnection implements Connection {
  readonly sent: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;
  pings = 0;
  terminated = false;
  onClose: (() => void) | null = null;
  constructor(readonly id: string) {}
  send(message: ServerMessage): void {
    this.sent.push(structuredClone(message));
  }
  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.onClose?.();
  }
  ping(): void {
    this.pings += 1;
  }
  terminate(): void {
    this.terminated = true;
    this.onClose?.();
  }
}

function setup(limits: Partial<Limits> = {}) {
  let now = 1_000;
  const logs: Parameters<RoomLog["info"]>[0][] = [];
  const log: RoomLog = { info: (fields) => logs.push(fields) };
  const service = new RoomService(
    () => now,
    { maxRooms: 10, maxPending: 10, ...limits },
    log,
  );
  const advance = (ms: number) => {
    now += ms;
  };
  const connect = (id: string, roomId = ROOM) => {
    const conn = new FakeConnection(id);
    conn.onClose = () => service.close(conn);
    service.open(conn, roomId);
    return conn;
  };
  const join = (conn: FakeConnection, token: string, name: string) => {
    service.message(
      conn,
      JSON.stringify({ type: "join", sessionToken: token, name }),
    );
  };
  return { service, connect, join, logs, log, advance };
}

function snapshots(conn: FakeConnection) {
  return conn.sent.filter((message) => message.type === "snapshot");
}

describe("RoomService — the four contracts", () => {
  it("hides a pre-reveal vote change from everyone except the voter", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    service.message(bob, JSON.stringify({ type: "castVote", card: "5" }));
    alice.sent.length = 0;
    bob.sent.length = 0;

    service.message(bob, JSON.stringify({ type: "castVote", card: "8" }));

    expect(alice.sent).toEqual([]);
    expect(snapshots(bob)).toHaveLength(1);
    const update = snapshots(bob)[0];
    expect(update?.type).toBe("snapshot");
    if (update?.type === "snapshot" && update.snapshot.phase === "voting") {
      expect(update.snapshot.yourVote).toBe("8");
    } else {
      expect.fail("Bob should see his own updated vote");
    }
  });

  it("supersedes the old socket without dispatching disconnect", () => {
    const { connect, join } = setup();
    const alice = connect("alice-1");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    const bobBefore = bob.sent.length;

    const secondTab = connect("alice-2");
    join(secondTab, ALICE, "Alice");

    expect(alice.closedWith).toEqual({
      code: CloseCode.SUPERSEDED,
      reason: "superseded",
    });
    expect(bob.sent.length).toBe(bobBefore);
    const seen = snapshots(secondTab).at(-1);
    expect(seen?.type).toBe("snapshot");
    if (seen?.type === "snapshot") {
      const aliceView = seen.snapshot.participants.find(
        (p) => p.name === "Alice",
      );
      expect(aliceView?.status).toBe("connected");
    }
  });

  it("sends the second tab a snapshot even when join changes nothing", () => {
    const { connect, join } = setup();
    const first = connect("tab-1");
    join(first, ALICE, "Alice");
    const second = connect("tab-2");
    join(second, ALICE, "Alice");
    expect(snapshots(second).length).toBeGreaterThan(0);
  });

  it("never puts the session token in a message sent to anyone", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    service.message(alice, JSON.stringify({ type: "reveal" }));
    const wire = JSON.stringify([...alice.sent, ...bob.sent]);
    expect(wire).not.toContain(ALICE);
    expect(wire).not.toContain(BOB);
  });
});

describe("RoomService", () => {
  it("sends the joiner a snapshot and tells the others", () => {
    const { connect, join } = setup();
    const alice = connect("alice");
    join(alice, ALICE, "Alice");
    expect(snapshots(alice)).toHaveLength(1);

    const bob = connect("bob");
    join(bob, BOB, "Bob");
    expect(snapshots(bob)).toHaveLength(1);
    expect(snapshots(alice)).toHaveLength(2);
  });

  it("rejects a command before join and leaves the socket open", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    expect(alice.sent).toEqual([{ type: "error", code: "NOT_JOINED" }]);
    join(alice, ALICE, "Alice");
    expect(snapshots(alice)).toHaveLength(1);
  });

  it("rejects invalid JSON and keeps the socket open", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    service.message(alice, "not json {");
    expect(alice.sent).toEqual([{ type: "error", code: "INVALID_MESSAGE" }]);
    join(alice, ALICE, "Alice");
    expect(snapshots(alice)).toHaveLength(1);
  });

  it("sends a domain error to the sender only", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    service.message(alice, JSON.stringify({ type: "reveal" }));
    const aliceBefore = alice.sent.length;
    const bobBefore = bob.sent.length;

    service.message(bob, JSON.stringify({ type: "castVote", card: "8" }));

    expect(bob.sent.at(-1)).toEqual({ type: "error", code: "VOTING_CLOSED" });
    expect(alice.sent.length).toBe(aliceBefore);
    expect(bob.sent.length).toBe(bobBefore + 1);
  });

  it("sends nothing when a command changes nothing", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    alice.sent.length = 0;
    bob.sent.length = 0;

    service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));

    expect(alice.sent).toEqual([]);
    expect(bob.sent).toEqual([]);
  });

  it("sends the reveal to everyone", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    alice.sent.length = 0;
    bob.sent.length = 0;

    service.message(alice, JSON.stringify({ type: "reveal" }));

    for (const conn of [alice, bob]) {
      const message = snapshots(conn).at(-1);
      expect(message?.type).toBe("snapshot");
      if (message?.type === "snapshot")
        expect(message.snapshot.phase).toBe("revealed");
    }
  });

  it("shows a closed socket as disconnected to the others", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    bob.sent.length = 0;

    service.close(alice);

    const message = snapshots(bob).at(-1);
    expect(message?.type).toBe("snapshot");
    if (message?.type === "snapshot") {
      const view = message.snapshot.participants.find(
        (p) => p.name === "Alice",
      );
      expect(view?.status).toBe("disconnected");
    }
  });

  it("removes a leaver, and the following close changes nothing", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    bob.sent.length = 0;

    service.message(alice, JSON.stringify({ type: "leave" }));

    expect(alice.closedWith).toEqual({ code: 1000, reason: "left" });
    const message = snapshots(bob).at(-1);
    expect(message?.type).toBe("snapshot");
    if (message?.type === "snapshot") {
      expect(message.snapshot.participants.map((p) => p.name)).toEqual(["Bob"]);
    }
    const bobBefore = bob.sent.length;
    service.close(alice);
    expect(bob.sent.length).toBe(bobBefore);
  });

  it("does not keep a room when the first join fails", () => {
    const { service, connect, join } = setup({ maxRooms: 1 });
    const ghost = connect("ghost", "aaaaaaaaaaa");
    service.message(
      ghost,
      JSON.stringify({
        type: "join",
        sessionToken: ALICE,
        name: "x".repeat(33),
      }),
    );
    expect(ghost.sent).toEqual([{ type: "error", code: "INVALID_NAME" }]);

    const bob = connect("bob", "bbbbbbbbbbb");
    join(bob, BOB, "Bob");
    expect(snapshots(bob)).toHaveLength(1);
  });

  it("refuses a new room once maxRooms is reached", () => {
    const { connect, join } = setup({ maxRooms: 1 });
    const alice = connect("alice", "aaaaaaaaaaa");
    join(alice, ALICE, "Alice");
    const bob = connect("bob", "bbbbbbbbbbb");
    join(bob, BOB, "Bob");
    expect(bob.sent).toEqual([{ type: "error", code: "SERVER_FULL" }]);
  });

  it("empties connection bookkeeping after every socket closes", () => {
    const { service, connect, join, advance } = setup();
    // Every way a socket can go, across two rooms.
    const alice = connect("alice");
    join(alice, ALICE, "Alice");
    const aliceTab2 = connect("alice-tab2");
    join(aliceTab2, ALICE, "Alice"); // supersedes `alice`, which closes
    const bob = connect("bob");
    join(bob, BOB, "Bob");
    service.message(bob, JSON.stringify({ type: "leave" })); // leaves, which closes
    const carol = connect("carol", "bbbbbbbbbbb");
    join(carol, "SESSIONTOKEN_CAROL_00001", "Carol");
    const nameless = connect("nameless", "ccccccccccc");
    join(nameless, "SESSIONTOKEN_NAMELESS_01", " "); // join fails, stays pending
    const lurker = connect("lurker"); // never joins
    const idler = connect("idler"); // never joins; the sweep closes it
    const dave = connect("dave", "ddddddddddd");
    join(dave, "SESSIONTOKEN_DAVE_000001", "Dave"); // goes silent
    advance(JOIN_TIMEOUT_MS);
    for (const conn of [aliceTab2, carol, nameless, lurker]) {
      service.close(conn);
    }
    service.sweep();
    advance(PONG_TIMEOUT_MS);
    service.sweep(); // the heartbeat terminates dave

    expect(alice.closedWith?.code).toBe(CloseCode.SUPERSEDED);
    expect(bob.closedWith?.code).toBe(1000);
    expect(idler.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
    expect(dave.terminated).toBe(true);
    expect(service.bookkeeping()).toEqual({
      pending: 0,
      bindings: 0,
      socketRooms: 0,
      sockets: 0,
      lastSent: 0,
      liveness: 0,
    });
  });

  it("logs a room correlation id, never the room id or a token", () => {
    const { service, connect, join, logs, log } = setup();
    // By construction: the service keeps no reference to the raw logger, so
    // there is nothing a future method could call to bypass the redaction.
    expect(Object.values(service)).not.toContain(log);

    const alice = connect("alice");
    join(alice, ALICE, "Alice");
    join(connect("alice-tab2"), ALICE, "Alice"); // supersede
    const bob = connect("bob");
    join(bob, BOB, "Bob");
    service.message(bob, "{nope"); // error path
    service.message(bob, JSON.stringify({ type: "leave" })); // leave, then close

    // Every call site was exercised, so the assertions below are not vacuous.
    expect(new Set(logs.map((line) => line.type ?? line.code))).toEqual(
      new Set([
        "open",
        "join",
        "supersede",
        "close",
        "INVALID_MESSAGE",
        "leave",
      ]),
    );
    // A close after leave has no binding left, so it carries no room at all.
    const rooms = logs.flatMap((line) => (line.room ? [line.room] : []));
    expect(new Set(rooms)).toEqual(new Set([roomLogId(ROOM)]));
    const text = JSON.stringify(logs);
    for (const secret of [ROOM, ALICE, BOB]) expect(text).not.toContain(secret);
  });

  it("ignores a message from a connection that was never opened", () => {
    const { service } = setup();
    const stray = new FakeConnection("stray");
    service.message(stray, JSON.stringify({ type: "reveal" }));
    expect(stray.sent).toEqual([]);
  });

  it("treats a second close as a no-op", () => {
    const { service, connect, join } = setup();
    const alice = connect("alice");
    const bob = connect("bob");
    join(alice, ALICE, "Alice");
    join(bob, BOB, "Bob");
    service.close(alice);
    const bobBefore = bob.sent.length;
    service.close(alice);
    expect(bob.sent.length).toBe(bobBefore);
  });
});

describe("RoomService — sweep: join timeout (#14)", () => {
  it("closes an unjoined socket once JOIN_TIMEOUT_MS has passed", () => {
    const { service, connect, advance } = setup();
    const lurker = connect("lurker");

    advance(JOIN_TIMEOUT_MS - 1);
    service.sweep();
    expect(lurker.closedWith).toBeNull();

    advance(1);
    service.sweep();
    expect(lurker.closedWith).toEqual({
      code: CloseCode.JOIN_TIMEOUT,
      reason: "join timeout",
    });
    expect(service.bookkeeping().pending).toBe(0);
  });

  it("never times out a socket that joined in time", () => {
    const { service, connect, join, advance } = setup();
    const alice = connect("alice");
    advance(JOIN_TIMEOUT_MS - 1);
    join(alice, ALICE, "Alice");

    advance(JOIN_TIMEOUT_MS * 10);
    service.sweep();
    expect(alice.closedWith).toBeNull();
  });

  it("still times out a socket whose join failed", () => {
    const { service, connect, join, advance } = setup();
    const nameless = connect("nameless");
    join(nameless, ALICE, " "); // INVALID_NAME: stays pending

    advance(JOIN_TIMEOUT_MS);
    service.sweep();
    expect(nameless.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
  });

  it("times out each socket against its own open time", () => {
    const { service, connect, advance } = setup();
    const early = connect("early");
    advance(JOIN_TIMEOUT_MS / 2);
    const late = connect("late");

    advance(JOIN_TIMEOUT_MS / 2);
    service.sweep();
    expect(early.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
    expect(late.closedWith).toBeNull();
  });

  it("ignores a frame from a timed-out socket that races its close", () => {
    const { service, connect, join, advance } = setup();
    const lurker = connect("lurker");
    lurker.onClose = null; // the transport has not delivered close yet
    advance(JOIN_TIMEOUT_MS);
    service.sweep();

    join(lurker, ALICE, "Alice");
    expect(lurker.sent).toEqual([]);
    expect(service.bookkeeping().bindings).toBe(0);
  });
});

describe("RoomService — pending cap (#15)", () => {
  it("closes a socket beyond the cap with 1013 and never tracks it", () => {
    const { service, connect } = setup({ maxPending: 2 });
    connect("a");
    connect("b");
    const c = connect("c");

    expect(c.closedWith).toEqual({ code: 1013, reason: "try again later" });
    expect(service.bookkeeping().pending).toBe(2);
  });

  it("frees a slot when a pending socket joins, closes or times out", () => {
    const { service, connect, join, advance } = setup({ maxPending: 2 });
    const a = connect("a");
    const b = connect("b");

    join(a, ALICE, "Alice"); // joined sockets do not count
    expect(connect("c").closedWith).toBeNull();

    service.close(b);
    expect(connect("d").closedWith).toBeNull();

    advance(JOIN_TIMEOUT_MS);
    service.sweep(); // times out c and d
    expect(connect("e").closedWith).toBeNull();
    expect(connect("f").closedWith).toBeNull();
    expect(connect("g").closedWith?.code).toBe(1013);
  });
});

describe("RoomService — sweep: heartbeat (#13)", () => {
  function twoInRoom() {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    const bob = ctx.connect("bob");
    ctx.join(bob, BOB, "Bob");
    return { ...ctx, alice, bob };
  }

  /** Sweeps every `step` ms for `total` ms; `answer` connections pong to pings. */
  function run(
    ctx: ReturnType<typeof setup>,
    total: number,
    step: number,
    answer: FakeConnection[],
  ) {
    const seen = new Map(answer.map((conn) => [conn, conn.pings]));
    for (let t = 0; t < total; t += step) {
      ctx.advance(step);
      ctx.service.sweep();
      for (const conn of answer) {
        if (conn.pings !== seen.get(conn)) ctx.service.pong(conn);
        seen.set(conn, conn.pings);
      }
    }
  }

  it("terminates a connection whose last pong is PONG_TIMEOUT_MS old", () => {
    const { service, alice, bob, advance } = twoInRoom();
    advance(PONG_TIMEOUT_MS - 1);
    service.pong(bob);
    service.sweep();
    expect(alice.terminated).toBe(false);

    bob.sent.length = 0;
    advance(1);
    service.sweep();
    expect(alice.terminated).toBe(true);
    // terminate() goes through the normal close path, so others see it.
    expect(snapshots(bob).at(-1)?.snapshot.participants).toMatchObject([
      { name: "Alice", status: "disconnected" },
      { name: "Bob", status: "connected" },
    ]);
  });

  it("pings a connection once PING_INTERVAL_MS has passed, and not more often", () => {
    const { service, alice, advance } = twoInRoom();
    advance(PING_INTERVAL_MS - 1);
    service.sweep();
    expect(alice.pings).toBe(0);

    advance(1);
    service.sweep();
    service.sweep();
    expect(alice.pings).toBe(1);

    advance(PING_INTERVAL_MS);
    service.sweep();
    expect(alice.pings).toBe(2);
  });

  it("keeps a connection that answers every ping open indefinitely", () => {
    const ctx = twoInRoom();
    run(ctx, PONG_TIMEOUT_MS * 20, 5_000, [ctx.alice, ctx.bob]);

    expect(ctx.alice.terminated).toBe(false);
    expect(ctx.alice.pings).toBeGreaterThan(20);
  });

  it.each([1_000, 3_000, 5_000])(
    "terminates within one sweep interval of the deadline (%i ms interval)",
    (step) => {
      const ctx = twoInRoom();
      let elapsed = 0;
      while (!ctx.alice.terminated && elapsed < PONG_TIMEOUT_MS * 2) {
        run(ctx, step, step, [ctx.bob]);
        elapsed += step;
      }
      expect(elapsed).toBeGreaterThanOrEqual(PONG_TIMEOUT_MS);
      expect(elapsed).toBeLessThan(PONG_TIMEOUT_MS + step);
      expect(ctx.bob.terminated).toBe(false);
    },
  );

  it("leaves unjoined sockets to the join timeout", () => {
    const { service, connect, advance } = setup();
    const lurker = connect("lurker");
    lurker.onClose = null; // keep it around, as if its close were still in flight
    advance(PONG_TIMEOUT_MS);
    service.sweep();
    expect(lurker.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
    expect(lurker.pings).toBe(0);
    expect(lurker.terminated).toBe(false);
  });

  it("ignores a pong from a connection that is not joined", () => {
    const { service, connect } = setup();
    const lurker = connect("lurker");
    service.pong(lurker);
    service.pong(new FakeConnection("stray"));
    expect(service.bookkeeping().liveness).toBe(0);
  });
});
