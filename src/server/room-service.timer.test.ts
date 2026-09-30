import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../shared/protocol.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import type { Connection, Scheduler } from "./room-service.js";
import { ROOM_TTL_MS, RoomService, SWEEP_INTERVAL_MS } from "./room-service.js";

/**
 * The room timer's scheduling (ADR 0008), with a fake clock and a fake
 * scheduler: the reveal lands exactly at the deadline, every path that stops
 * the timer clears its callback, and a stale callback never reveals.
 */

const ROOM = "abcdefghijk";
const MIN = 60_000;

class FakeConnection implements Connection {
  readonly sent: ServerMessage[] = [];
  constructor(readonly id: string) {}
  send(message: ServerMessage): void {
    this.sent.push(structuredClone(message));
  }
  close(): void {}
  ping(): void {}
  terminate(): void {}
}

/** Timers that run only when told, against the same fake clock. */
class FakeScheduler implements Scheduler {
  private nextId = 1;
  readonly pending = new Map<
    number,
    { readonly at: number; readonly callback: () => void }
  >();
  constructor(private readonly now: () => number) {}
  set(delayMs: number, callback: () => void): unknown {
    const id = this.nextId++;
    this.pending.set(id, { at: this.now() + delayMs, callback });
    return id;
  }
  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  /** Runs every timer that is due now, as the event loop would. */
  runDue(): void {
    for (const [id, timer] of [...this.pending]) {
      if (timer.at > this.now()) continue;
      this.pending.delete(id);
      timer.callback();
    }
  }
  /** Every pending timer, due or not: what a stale callback looks like. */
  callbacks(): (() => void)[] {
    return [...this.pending.values()].map((timer) => timer.callback);
  }
}

function setup() {
  let now = 1_000_000;
  const scheduler = new FakeScheduler(() => now);
  const service = new RoomService(
    () => now,
    { maxRooms: 10, maxPending: 10 },
    { scheduler },
  );
  const people = ["Ada", "Ben"].map((name) => {
    const conn = new FakeConnection(name);
    service.open(conn, ROOM);
    service.message(
      conn,
      JSON.stringify({
        type: "join",
        sessionToken: `SESSIONTOKEN_${name.toUpperCase()}_000000000`,
        name,
      }),
    );
    return conn;
  });
  const [ada, ben] = people as [FakeConnection, FakeConnection];
  const send = (conn: FakeConnection, message: object) =>
    service.message(conn, JSON.stringify(message));
  const last = (conn: FakeConnection): RoomSnapshot => {
    const snapshots = conn.sent.filter((m) => m.type === "snapshot");
    const message = snapshots.at(-1);
    if (message?.type !== "snapshot") throw new Error("no snapshot");
    return message.snapshot;
  };
  return {
    service,
    scheduler,
    ada,
    ben,
    send,
    last,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

/** Ada starts a one-minute timer, and Ben votes. */
function runningWithAVote() {
  const t = setup();
  t.send(t.ada, { type: "timerStart" });
  t.send(t.ben, { type: "castVote", card: "5" });
  return t;
}

describe("the room timer's scheduling", () => {
  it("reveals exactly at the deadline, for everyone, marked as the timer's", () => {
    const t = runningWithAVote();
    expect(t.service.bookkeeping().timers).toBe(1);
    t.advance(MIN - 1);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("voting");
    t.advance(1);
    t.scheduler.runDue();
    for (const conn of [t.ada, t.ben]) {
      const snapshot = t.last(conn);
      expect(snapshot.phase).toBe("revealed");
      if (snapshot.phase === "revealed")
        expect(snapshot.revealCause).toBe("timer");
    }
    expect(t.service.bookkeeping().timers).toBe(0);
  });

  it("schedules again, and reveals nothing, if the callback fires early", () => {
    const t = runningWithAVote();
    const [early] = t.scheduler.callbacks();
    t.advance(MIN - 5_000);
    early?.(); // a timer that went off 5 s too soon
    expect(t.last(t.ben).phase).toBe("voting");
    expect(t.service.bookkeeping().timers).toBe(1);
    t.advance(5_000);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("revealed");
  });

  it("pausing clears the callback; resuming schedules it again from what was left", () => {
    const t = runningWithAVote();
    t.advance(20_000);
    t.send(t.ada, { type: "timerPause" });
    expect(t.service.bookkeeping().timers).toBe(0);
    expect(t.scheduler.pending.size).toBe(0);
    t.advance(10 * MIN);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("voting");
    t.send(t.ada, { type: "timerResume" });
    t.advance(40_000 - 1);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("voting");
    t.advance(1);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("revealed");
  });

  it("+30 s moves the callback: nothing at the old deadline, the reveal at the new one", () => {
    const t = runningWithAVote();
    t.send(t.ada, { type: "timerAdd" });
    expect(t.scheduler.pending.size).toBe(1);
    t.advance(MIN);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("voting");
    t.advance(30_000);
    t.scheduler.runDue();
    expect(t.last(t.ben).phase).toBe("revealed");
  });

  it.each([
    ["a reveal by a person", { type: "reveal" }],
    ["Start next round", { type: "reset" }],
  ])("%s clears the callback", (_, message) => {
    const t = runningWithAVote();
    t.send(t.ada, message);
    expect(t.service.bookkeeping().timers).toBe(0);
    expect(t.scheduler.pending.size).toBe(0);
  });

  it("eviction clears the callback", () => {
    const t = runningWithAVote();
    t.send(t.ada, { type: "leave" });
    t.send(t.ben, { type: "leave" });
    for (let waited = 0; waited <= ROOM_TTL_MS; waited += SWEEP_INTERVAL_MS) {
      t.advance(SWEEP_INTERVAL_MS);
      t.service.sweep();
    }
    expect(t.service.bookkeeping().rooms).toBe(0);
    expect(t.service.bookkeeping().timers).toBe(0);
    expect(t.scheduler.pending.size).toBe(0);
  });

  describe("a stale callback never reveals", () => {
    it("after +30 s moved the deadline", () => {
      const t = runningWithAVote();
      const [old] = t.scheduler.callbacks();
      t.send(t.ada, { type: "timerAdd" });
      t.advance(MIN);
      old?.();
      expect(t.last(t.ben).phase).toBe("voting");
    });

    it("after a pause", () => {
      const t = runningWithAVote();
      const [old] = t.scheduler.callbacks();
      t.advance(10_000);
      t.send(t.ada, { type: "timerPause" });
      t.advance(2 * MIN);
      old?.();
      expect(t.last(t.ben).phase).toBe("voting");
    });

    it("after a person revealed and the next round started a new timer", () => {
      const t = runningWithAVote();
      const [old] = t.scheduler.callbacks();
      t.advance(10_000);
      t.send(t.ada, { type: "reveal" });
      t.send(t.ada, { type: "reset" });
      t.send(t.ada, { type: "timerStart" }); // ends 10 s after the old one
      t.send(t.ben, { type: "castVote", card: "8" });
      t.advance(MIN - 10_000); // the old deadline: the new round must go on
      old?.();
      expect(t.last(t.ben).phase).toBe("voting");
      expect(t.service.bookkeeping().timers).toBe(1);
    });
  });

  it("shutdown leaves nothing pending, and a callback after it does nothing", () => {
    const t = runningWithAVote();
    const [callback] = t.scheduler.callbacks();
    t.service.shutdown();
    expect(t.service.bookkeeping().timers).toBe(0);
    expect(t.scheduler.pending.size).toBe(0);
    t.advance(MIN);
    const before = t.ben.sent.length;
    callback?.();
    expect(t.ben.sent.length).toBe(before);
  });

  it("an idle room sends nothing extra: serverNow is beside the snapshot, not compared", () => {
    const t = setup();
    const before = [t.ada.sent.length, t.ben.sent.length];
    t.advance(30_000);
    t.send(t.ada, { type: "timerPause" }); // a no-op on an idle timer
    t.send(t.ada, { type: "timerAdd" });
    t.service.sweep();
    expect([t.ada.sent.length, t.ben.sent.length]).toEqual(before);
  });

  it("sends the server's clock with every snapshot", () => {
    const t = runningWithAVote();
    const message = t.ada.sent.filter((m) => m.type === "snapshot").at(-1);
    expect(message).toMatchObject({ serverNow: t.now() });
  });
});
