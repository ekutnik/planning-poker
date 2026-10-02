import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../shared/protocol.js";
import { LogCaps } from "./limits/log-cap.js";
import type { Connection, RoomLog } from "./room-service.js";
import {
  DEFAULT_LIMITS,
  RATE_LIMITED_LOG_MS,
  RoomService,
} from "./room-service.js";

/**
 * One connection's message limits (#16): what a flood gets, what it doesn't
 * get to do, and that a healthy client's ping still gets through it.
 */

const ROOM = "abcdefghijk";

class FakeConnection implements Connection {
  readonly sent: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;
  onClose: (() => void) | null = null;
  constructor(readonly id: string) {}
  send(message: ServerMessage): void {
    this.sent.push(structuredClone(message));
  }
  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.onClose?.();
  }
  ping(): void {}
  terminate(): void {
    this.onClose?.();
  }
}

function setup() {
  let now = 1_000;
  const logs: Parameters<RoomLog["info"]>[0][] = [];
  const log: RoomLog = { info: (f) => logs.push(f), warn: (f) => logs.push(f) };
  const logCaps = new LogCaps();
  const service = new RoomService(
    () => now,
    { ...DEFAULT_LIMITS, maxRooms: 10, maxPending: 10 },
    { log, logCaps },
  );
  const connect = (id: string, token: string) => {
    const conn = new FakeConnection(id);
    conn.onClose = () => service.close(conn);
    service.open(conn, ROOM);
    service.message(
      conn,
      JSON.stringify({ type: "join", sessionToken: token, name: id }),
    );
    return conn;
  };
  const send = (conn: FakeConnection, message: object | string) =>
    service.message(
      conn,
      typeof message === "string" ? message : JSON.stringify(message),
    );
  const advance = (ms: number) => {
    now += ms;
  };
  return { service, connect, send, advance, logs, logCaps, now: () => now };
}

const vote = (i: number) => ({ type: "castVote", card: i % 2 ? "8" : "5" });
const of = (conn: FakeConnection, type: ServerMessage["type"]) =>
  conn.sent.filter((message) => message.type === type);
const rateLimited = (conn: FakeConnection) =>
  conn.sent.filter(
    (message) => message.type === "error" && message.code === "RATE_LIMITED",
  );
const lastVersion = (conn: FakeConnection) => {
  const last = of(conn, "snapshot").at(-1);
  return last?.type === "snapshot" ? last.snapshot.version : null;
};

describe("one connection's messages (#16)", () => {
  it("applies 20 at once, then refuses the rest without applying them", () => {
    const { connect, send } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001"); // the join is one
    const joined = lastVersion(ada) ?? 0;
    for (let i = 0; i < 25; i += 1) send(ada, vote(i));
    // 19 votes went in, each a new version; 6 were refused.
    expect(of(ada, "snapshot")).toHaveLength(1 + 19);
    expect(lastVersion(ada)).toBe(joined + 19);
    expect(rateLimited(ada)).toHaveLength(1);
  });

  it("refills at 5 a second: a person clicking fast never meets it", () => {
    const { connect, send, advance } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 300; i += 1) {
      advance(250); // 4 a second, for 75 s
      send(ada, vote(i));
    }
    expect(rateLimited(ada)).toHaveLength(0);
    expect(of(ada, "snapshot")).toHaveLength(301);
  });

  it("answers RATE_LIMITED at most once a second", () => {
    const { connect, send, advance } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 19; i += 1) send(ada, vote(i));
    // 3 s at 8 a second: 5 go in each second, 3 are refused.
    for (let i = 0; i < 24; i += 1) {
      advance(125);
      send(ada, vote(i));
    }
    expect(rateLimited(ada).length).toBeGreaterThanOrEqual(2);
    expect(rateLimited(ada).length).toBeLessThanOrEqual(3);
    expect(ada.closedWith).toBeNull(); // 3 refused a second never runs out of strikes
  });

  it("closes with 1008 once the strikes run out, and reads nothing more", () => {
    const { connect, send, logs } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 59; i += 1) send(ada, vote(i)); // 19 in, 40 refused
    expect(ada.closedWith).toBeNull();
    send(ada, vote(59)); // the 41st refusal
    expect(ada.closedWith).toEqual({ code: 1008, reason: "rate limited" });
    expect(logs).toContainEqual({
      type: "rate-limited",
      limit: "strikes",
      conn: "Ada",
    });
  });

  it("counts a malformed message too, so INVALID_MESSAGE floods are bounded", () => {
    const { connect, send } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 25; i += 1) send(ada, "not json");
    const invalid = ada.sent.filter(
      (message) =>
        message.type === "error" && message.code === "INVALID_MESSAGE",
    );
    expect(invalid).toHaveLength(19);
    expect(rateLimited(ada)).toHaveLength(1);
  });

  it("counts a join: it's a message like any other", () => {
    const { service, send } = setup();
    const conn = new FakeConnection("anon");
    service.open(conn, ROOM);
    const join = {
      type: "join",
      sessionToken: "SESSIONTOKEN_ANON_000001",
      name: " ", // refused by the room, so the socket stays unjoined
    };
    for (let i = 0; i < 21; i += 1) send(conn, join);
    expect(rateLimited(conn)).toHaveLength(1);
  });

  it("logs nothing for a refused message, and the refusals once a minute", () => {
    const { connect, send, advance, logs } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 30; i += 1) send(ada, vote(i)); // 19 in, 11 refused
    const applied = logs.filter((line) => line.type === "castVote");
    expect(applied).toHaveLength(19);
    const limited = () => logs.filter((line) => line.type === "rate-limited");
    expect(limited()).toEqual([
      { type: "rate-limited", limit: "messages", conn: "Ada", count: 1 },
    ]);
    advance(RATE_LIMITED_LOG_MS - 1_000);
    for (let i = 0; i < 25; i += 1) send(ada, vote(i)); // 20 in, 5 refused
    expect(limited()).toHaveLength(1);
    advance(1_000);
    for (let i = 0; i < 22; i += 1) send(ada, vote(i)); // 5 in, 17 refused
    // The next line carries the 15 refused since the last one, and this one.
    expect(limited().at(-1)).toEqual({
      type: "rate-limited",
      limit: "messages",
      conn: "Ada",
      count: 16,
    });
    // No line names an address, a room or anything sent.
    for (const line of limited()) {
      expect(Object.keys(line).sort()).toEqual(
        ["conn", "count", "limit", "type"].sort(),
      );
    }
  });
});

describe("the client's liveness ping (#16, #20)", () => {
  it("gets through a command flood: pings have their own bucket", () => {
    const { connect, send, advance } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    let pings = 0;
    let commands = 0;
    // 10 commands a second, a ping every 20 s, until the strikes run out.
    for (let ms = 0; ada.closedWith === null && ms < 120_000; ms += 100) {
      send(ada, vote(commands));
      commands += 1;
      // Right after a command, when the flood has just emptied the message
      // bucket: a ping sharing it would be refused here.
      if (ms % 20_000 === 0 && ada.closedWith === null) {
        const before = of(ada, "pong").length;
        send(ada, { type: "ping" });
        pings += 1;
        expect(of(ada, "pong")).toHaveLength(before + 1);
      }
      advance(100);
    }
    // Closed at last, as the flood deserved, but every ping before it got
    // its pong: about 40 s at 10 a second, so at least two pings.
    expect(ada.closedWith?.code).toBe(1008);
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(of(ada, "pong")).toHaveLength(pings);
  });

  it("drops a ping flood silently, past 5, and takes a strike for each", () => {
    const { connect, send } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 46; i += 1) send(ada, { type: "ping" });
    expect(of(ada, "pong")).toHaveLength(5);
    expect(rateLimited(ada)).toHaveLength(0);
    expect(ada.closedWith?.code).toBe(1008); // 41 refused: out of strikes
  });

  it("keeps a healthy client's ping, every 20 s, well inside its bucket", () => {
    const { connect, send, advance } = setup();
    const ada = connect("Ada", "SESSIONTOKEN_ADA_0000001");
    for (let i = 0; i < 100; i += 1) {
      send(ada, { type: "ping" });
      advance(20_000);
    }
    expect(of(ada, "pong")).toHaveLength(100);
  });
});

describe("the limits' log lines, for the whole server (#16)", () => {
  it("caps the rate-limited lines across connections, not per connection", () => {
    const { connect, send, logs, logCaps, now } = setup();
    // 30 connections each refused once: one line each, were it per
    // connection; 10 with the cap, and the rest counted.
    for (let c = 0; c < 30; c += 1) {
      const conn = connect(
        `c${String(c)}`,
        `SESSIONTOKEN_C${String(c).padStart(2, "0")}_000000000`,
      );
      for (let i = 0; i < 20; i += 1) send(conn, vote(i));
    }
    expect(logs.filter((line) => line.type === "rate-limited")).toHaveLength(
      10,
    );
    expect(logCaps.due(now() + 60_000)).toEqual([
      { line: "rate-limited", count: 20 },
    ]);
  });
});

describe("rooms created per address (ADR 0009)", () => {
  const HOUR = 60 * 60_000;
  /** A room id for room n: 11 characters of the room-id alphabet. */
  const roomId = (n: number) => `room${String(n).padStart(7, "0")}`;

  function creator() {
    let now = 1_000;
    const logs: Parameters<RoomLog["info"]>[0][] = [];
    const log: RoomLog = {
      info: (f) => logs.push(f),
      warn: (f) => logs.push(f),
    };
    const service = new RoomService(
      () => now,
      { ...DEFAULT_LIMITS, maxRooms: 100 },
      { log },
    );
    let n = 0;
    const join = (room: string, key: string) => {
      n += 1;
      const conn = new FakeConnection(`c${String(n)}`);
      conn.onClose = () => service.close(conn);
      service.open(conn, room, key);
      service.message(
        conn,
        JSON.stringify({
          type: "join",
          sessionToken: `SESSIONTOKEN_${String(n).padStart(12, "0")}`,
          name: "Ada",
        }),
      );
      return conn;
    };
    const advance = (ms: number) => {
      now += ms;
    };
    return { service, join, advance, logs };
  }

  it("refuses the 11th room in an hour from one address: RATE_LIMITED, then 1013, and no room", () => {
    const { service, join, logs } = creator();
    for (let i = 0; i < 10; i += 1) {
      expect(of(join(roomId(i), "203.0.113.7"), "snapshot")).toHaveLength(1);
    }
    const refused = join(roomId(10), "203.0.113.7");
    expect(refused.sent).toEqual([{ type: "error", code: "RATE_LIMITED" }]);
    expect(refused.closedWith).toEqual({
      code: 1013,
      reason: "try again later",
    });
    expect(service.bookkeeping().rooms).toBe(10);
    expect(logs).toContainEqual({
      type: "rate-limited",
      limit: "rooms",
      conn: refused.id,
    });
  });

  it("never charges for joining a room that exists, so teammates aren't blocked", () => {
    const { join } = creator();
    for (let i = 0; i < 10; i += 1) join(roomId(i), "203.0.113.7");
    // The same office address, ten rooms made: joining one still works.
    for (let i = 0; i < 25; i += 1) {
      expect(of(join(roomId(0), "203.0.113.7"), "snapshot")).toHaveLength(1);
    }
  });

  it("keeps each address to its own rooms", () => {
    const { join } = creator();
    for (let i = 0; i < 10; i += 1) join(roomId(i), "203.0.113.7");
    expect(of(join(roomId(10), "198.51.100.2"), "snapshot")).toHaveLength(1);
  });

  it("gives the address a room back as its hour refills", () => {
    const { join, advance } = creator();
    for (let i = 0; i < 10; i += 1) join(roomId(i), "203.0.113.7");
    expect(join(roomId(10), "203.0.113.7").closedWith?.code).toBe(1013);
    advance(HOUR / 10); // one room's worth
    expect(of(join(roomId(11), "203.0.113.7"), "snapshot")).toHaveLength(1);
    expect(join(roomId(12), "203.0.113.7").closedWith?.code).toBe(1013);
    advance(HOUR);
    for (let i = 13; i < 23; i += 1) {
      expect(of(join(roomId(i), "203.0.113.7"), "snapshot")).toHaveLength(1);
    }
  });

  it("charges nothing for a join the room refuses", () => {
    const { service, join } = creator();
    for (let i = 0; i < 20; i += 1) {
      const conn = new FakeConnection(`bad${String(i)}`);
      service.open(conn, roomId(i), "203.0.113.7");
      service.message(
        conn,
        JSON.stringify({
          type: "join",
          sessionToken: `SESSIONTOKEN_BAD_${String(i).padStart(8, "0")}`,
          name: " ",
        }),
      );
    }
    expect(of(join(roomId(50), "203.0.113.7"), "snapshot")).toHaveLength(1);
  });
});
