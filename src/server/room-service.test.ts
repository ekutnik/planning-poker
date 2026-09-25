import { describe, expect, it } from "vitest";
import { CloseCode } from "../shared/close-codes.js";
import { DISCONNECT_GRACE_MS } from "./domain/room.js";
import type { ServerMessage } from "../shared/protocol.js";
import { roomLogId } from "./identity.js";
import type { Connection, Limits, RoomLog } from "./room-service.js";
import {
  JOIN_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  redactRoomIds,
  ROOM_TTL_MS,
  RoomService,
  STALL_INTERVALS,
  SWEEP_INTERVAL_MS,
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

function setup(
  limits: Partial<Limits> = {},
  sweepIntervalMs = SWEEP_INTERVAL_MS,
) {
  let now = 1_000;
  const logs: Parameters<RoomLog["info"]>[0][] = [];
  const warns: Parameters<RoomLog["warn"]>[0][] = [];
  const log: RoomLog = {
    info: (fields) => logs.push(fields),
    warn: (fields) => warns.push(fields),
  };
  const service = new RoomService(
    () => now,
    { maxRooms: 10, maxPending: 10, ...limits },
    { log, sweepIntervalMs },
  );
  const advance = (ms: number) => {
    now += ms;
  };
  /** Advances `ms` in sweep-interval steps, sweeping after each, like the real timer. */
  const tick = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += sweepIntervalMs) {
      advance(Math.min(sweepIntervalMs, ms - elapsed));
      service.sweep();
    }
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
  return { service, connect, join, logs, warns, log, advance, tick };
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
    const { service, connect, join, advance, tick } = setup();
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
    tick(PONG_TIMEOUT_MS); // the heartbeat terminates dave
    tick(DISCONNECT_GRACE_MS + ROOM_TTL_MS); // grace removal, then the room TTL

    expect(alice.closedWith?.code).toBe(CloseCode.SUPERSEDED);
    expect(bob.closedWith?.code).toBe(1000);
    expect(idler.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
    expect(dave.terminated).toBe(true);
    expect(service.bookkeeping()).toEqual({
      rooms: 0,
      emptyRooms: 0,
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

  it("scrubs room ids at every log level, including warn", () => {
    const lines: { level: string; room?: string }[] = [];
    const log = redactRoomIds({
      info: (fields) => lines.push({ level: "info", room: fields.room }),
      warn: (fields) => lines.push({ level: "warn", room: fields.room }),
    });
    log.info({ room: ROOM, type: "open" });
    log.warn({ room: ROOM, type: "anything" });
    log.warn({ type: "sweep-stalled", gapMs: 1 });

    expect(lines).toEqual([
      { level: "info", room: roomLogId(ROOM) },
      { level: "warn", room: roomLogId(ROOM) },
      { level: "warn", room: undefined },
    ]);
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

describe("RoomService — sweep: stall guard (#26)", () => {
  function scene(sweepIntervalMs = SWEEP_INTERVAL_MS) {
    const ctx = setup({}, sweepIntervalMs);
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    const bob = ctx.connect("bob");
    ctx.join(bob, BOB, "Bob");
    const lurker = ctx.connect("lurker");
    lurker.onClose = null; // keep it observable after a close
    ctx.service.sweep(); // a normal sweep sets the baseline
    return { ...ctx, alice, bob, lurker };
  }

  it("enforces no deadline in the sweep right after a pause, but still pings", () => {
    const { service, alice, bob, lurker, advance, logs, warns } = scene();
    advance(60_000); // the process was paused; every deadline looks missed
    service.sweep();

    expect(alice.terminated).toBe(false);
    expect(bob.terminated).toBe(false);
    expect(lurker.closedWith).toBeNull();
    expect([alice.pings, bob.pings]).toEqual([1, 1]);
    // Server health, so warn; not routine client behaviour at info.
    expect(warns).toEqual([{ type: "sweep-stalled", gapMs: 60_000 }]);
    expect(logs.map((line) => line.type)).not.toContain("sweep-stalled");
  });

  it("resumes on the next sweep, once the queued evidence has been read", () => {
    const { service, alice, bob, lurker, advance } = scene();
    advance(60_000);
    service.sweep();
    service.pong(bob); // bob's pong was queued behind the timer; alice's never came

    advance(SWEEP_INTERVAL_MS);
    service.sweep();
    expect(alice.terminated).toBe(true);
    expect(bob.terminated).toBe(false);
    expect(lurker.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
  });

  it("treats a gap of exactly the threshold as normal", () => {
    const { service, lurker, advance } = scene();
    advance(SWEEP_INTERVAL_MS * STALL_INTERVALS); // == JOIN_TIMEOUT_MS here
    service.sweep();
    expect(lurker.closedWith?.code).toBe(CloseCode.JOIN_TIMEOUT);
  });

  it("scales the threshold with the sweep interval it is told", () => {
    const { service, lurker, advance } = scene(1_000);
    advance(JOIN_TIMEOUT_MS); // 10 intervals of 1s: a stall at this cadence
    service.sweep();
    expect(lurker.closedWith).toBeNull();
  });
});

describe("RoomService — sweep: grace removal (#19)", () => {
  function voted() {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    const bob = ctx.connect("bob");
    ctx.join(bob, BOB, "Bob");
    ctx.service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    return { ...ctx, alice, bob };
  }
  const names = (conn: FakeConnection) =>
    snapshots(conn)
      .at(-1)
      ?.snapshot.participants.map((p) => `${p.name}:${p.status}`);

  it("removes a participant disconnected for the grace period, and tells the others", () => {
    const { service, alice, bob, tick } = voted();
    service.close(alice);
    // bob keeps answering pings throughout, so only alice is at stake.
    const keepBob = (ms: number) => {
      for (let t = 0; t < ms; t += SWEEP_INTERVAL_MS) {
        tick(SWEEP_INTERVAL_MS);
        service.pong(bob);
      }
    };

    keepBob(DISCONNECT_GRACE_MS - SWEEP_INTERVAL_MS);
    expect(names(bob)).toEqual(["Alice:disconnected", "Bob:connected"]);

    keepBob(SWEEP_INTERVAL_MS);
    expect(names(bob)).toEqual(["Bob:connected"]);
  });

  it("expires several participants of one room in the same sweep", () => {
    const { service, connect, join, alice, bob, tick } = voted();
    const carol = connect("carol");
    join(carol, "SESSIONTOKEN_CAROL_00001", "Carol");
    service.close(alice);
    service.close(carol);
    for (let t = 0; t < DISCONNECT_GRACE_MS; t += SWEEP_INTERVAL_MS) {
      tick(SWEEP_INTERVAL_MS);
      service.pong(bob);
    }
    expect(names(bob)).toEqual(["Bob:connected"]);
  });

  it("lets a participant who reconnects within the grace period keep seat and vote", () => {
    const { service, connect, join, alice, bob, tick } = voted();
    service.close(alice);
    tick(DISCONNECT_GRACE_MS - SWEEP_INTERVAL_MS);
    service.pong(bob);

    const aliceAgain = connect("alice-again");
    join(aliceAgain, ALICE, "Alice");
    tick(DISCONNECT_GRACE_MS);
    expect(snapshots(aliceAgain).at(-1)?.snapshot).toMatchObject({
      yourVote: "5",
    });
  });

  it("lets an expired participant rejoin only as someone new, with no vote", () => {
    const { service, connect, join, alice, tick } = voted();
    service.close(alice);
    tick(DISCONNECT_GRACE_MS);

    const aliceAgain = connect("alice-again");
    join(aliceAgain, ALICE, "Alice");
    expect(snapshots(aliceAgain).at(-1)?.snapshot).toMatchObject({
      yourVote: null,
    });
  });

  it("does not expire anyone in the sweep right after a stall", () => {
    const { service, alice, bob, advance } = voted();
    service.close(alice);
    service.sweep();
    advance(DISCONNECT_GRACE_MS * 2); // paused well past the grace period
    service.sweep();
    expect(names(bob)).toContain("Alice:disconnected");
    service.pong(bob); // bob's pong was queued behind the timer during the pause

    advance(SWEEP_INTERVAL_MS);
    service.sweep();
    expect(names(bob)).not.toContain("Alice:disconnected");
  });

  it("removes a closed laptop within PONG_TIMEOUT + GRACE + two sweep intervals", () => {
    const { service, alice, bob, advance } = voted();
    // alice's lid closes: she never answers again. bob answers every ping.
    let elapsed = 0;
    let disconnectedAt: number | undefined;
    let removedAt: number | undefined;
    while (removedAt === undefined && elapsed < 10 * 60_000) {
      advance(SWEEP_INTERVAL_MS);
      elapsed += SWEEP_INTERVAL_MS;
      service.sweep();
      service.pong(bob);
      const view = names(bob) ?? [];
      if (disconnectedAt === undefined && view.includes("Alice:disconnected"))
        disconnectedAt = elapsed;
      if (!view.some((entry) => entry.startsWith("Alice:")))
        removedAt = elapsed;
    }

    expect(alice.terminated).toBe(true);
    expect(disconnectedAt).toBeGreaterThanOrEqual(PONG_TIMEOUT_MS);
    expect(removedAt).toBeLessThanOrEqual(
      PONG_TIMEOUT_MS + DISCONNECT_GRACE_MS + 2 * SWEEP_INTERVAL_MS,
    );
  });
});

describe("RoomService — sweep: room TTL (#18)", () => {
  function leaveRoom(ctx: ReturnType<typeof setup>, conn: FakeConnection) {
    ctx.service.message(conn, JSON.stringify({ type: "leave" }));
  }

  it("evicts a room once it has been empty for ROOM_TTL_MS", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    leaveRoom(ctx, alice);
    expect(ctx.service.bookkeeping()).toMatchObject({
      rooms: 1,
      emptyRooms: 1,
    });

    ctx.tick(ROOM_TTL_MS - SWEEP_INTERVAL_MS);
    expect(ctx.service.bookkeeping().rooms).toBe(1);

    ctx.tick(SWEEP_INTERVAL_MS);
    expect(ctx.service.bookkeeping()).toMatchObject({
      rooms: 0,
      emptyRooms: 0,
    });
  });

  it("counts the TTL from when grace removal empties the room", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    ctx.service.close(alice); // disconnected: not empty until grace removal
    ctx.tick(DISCONNECT_GRACE_MS);
    expect(ctx.service.bookkeeping()).toMatchObject({
      rooms: 1,
      emptyRooms: 1,
    });

    ctx.tick(ROOM_TTL_MS);
    expect(ctx.service.bookkeeping().rooms).toBe(0);
  });

  it("never evicts a room that has participants, however long it lasts", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    for (let t = 0; t < ROOM_TTL_MS * 3; t += SWEEP_INTERVAL_MS) {
      ctx.tick(SWEEP_INTERVAL_MS);
      ctx.service.pong(alice);
    }
    expect(ctx.service.bookkeeping()).toMatchObject({
      rooms: 1,
      emptyRooms: 0,
    });
    expect(alice.terminated).toBe(false);
  });

  it("never evicts a room someone rejoined and stayed in", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    leaveRoom(ctx, alice);
    ctx.tick(ROOM_TTL_MS - SWEEP_INTERVAL_MS);

    const bob = ctx.connect("bob");
    ctx.join(bob, BOB, "Bob"); // the room is occupied again
    for (let t = 0; t < ROOM_TTL_MS * 2; t += SWEEP_INTERVAL_MS) {
      ctx.tick(SWEEP_INTERVAL_MS);
      ctx.service.pong(bob);
    }
    expect(ctx.service.bookkeeping()).toMatchObject({
      rooms: 1,
      emptyRooms: 0,
    });
    ctx.service.message(bob, JSON.stringify({ type: "castVote", card: "3" }));
    expect(snapshots(bob).at(-1)?.snapshot).toMatchObject({ yourVote: "3" });
  });

  it("resets the TTL when someone joins the empty room again", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    leaveRoom(ctx, alice);
    ctx.tick(ROOM_TTL_MS - SWEEP_INTERVAL_MS);

    const bob = ctx.connect("bob");
    ctx.join(bob, BOB, "Bob");
    leaveRoom(ctx, bob);
    ctx.tick(ROOM_TTL_MS - SWEEP_INTERVAL_MS);
    expect(ctx.service.bookkeeping().rooms).toBe(1);

    ctx.tick(SWEEP_INTERVAL_MS);
    expect(ctx.service.bookkeeping().rooms).toBe(0);
  });

  it("recreates an evicted room, empty, on the next join (ADR 0001)", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    ctx.service.message(alice, JSON.stringify({ type: "castVote", card: "5" }));
    leaveRoom(ctx, alice);
    ctx.tick(ROOM_TTL_MS);

    const bob = ctx.connect("bob");
    ctx.join(bob, BOB, "Bob");
    expect(snapshots(bob).at(-1)?.snapshot).toMatchObject({
      phase: "voting",
      participants: [{ name: "Bob", hasVoted: false }],
    });
    expect(ctx.service.bookkeeping()).toMatchObject({
      rooms: 1,
      emptyRooms: 0,
    });
  });

  it("frees the evicted room's maxRooms slot", () => {
    const ctx = setup({ maxRooms: 1 });
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    leaveRoom(ctx, alice);

    const early = ctx.connect("early", "bbbbbbbbbbb");
    ctx.join(early, BOB, "Bob");
    expect(early.sent).toEqual([{ type: "error", code: "SERVER_FULL" }]);

    ctx.tick(ROOM_TTL_MS);
    const late = ctx.connect("late", "bbbbbbbbbbb");
    ctx.join(late, BOB, "Bob");
    expect(snapshots(late)).toHaveLength(1);
  });

  it("evicts nothing in the sweep right after a stall", () => {
    const ctx = setup();
    const alice = ctx.connect("alice");
    ctx.join(alice, ALICE, "Alice");
    leaveRoom(ctx, alice);
    ctx.service.sweep();
    ctx.advance(ROOM_TTL_MS * 2);
    ctx.service.sweep();
    expect(ctx.service.bookkeeping().rooms).toBe(1);

    ctx.advance(SWEEP_INTERVAL_MS);
    ctx.service.sweep();
    expect(ctx.service.bookkeeping().rooms).toBe(0);
  });
});
