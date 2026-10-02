import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  socketPath,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import {
  buildServer,
  MAX_BUFFERED_BYTES,
  toConnection,
  type ServerOptions,
} from "./app.js";
import { CloseCode } from "../shared/close-codes.js";
import { ROOM_ID_PATTERN } from "../shared/rules.js";
import { roomLogId } from "./identity.js";
import {
  JOIN_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  RoomService,
} from "./room-service.js";

/**
 * A few end-to-end checks that the adapter is wired correctly. Room behaviour
 * is proven in room-service.test.ts with fake connections; these tests only
 * prove that real frames reach the service and its replies reach real sockets.
 */

type App = ReturnType<typeof buildServer>;

/** A websocket client that queues inbound messages so tests can await them in order. */
class TestClient {
  private readonly inbox: ServerMessage[] = [];
  private readonly waiters: ((message: ServerMessage) => void)[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString("utf8")) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.inbox.push(message);
    });
    this.closed = new Promise((resolve) => {
      socket.on("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  next(): Promise<ServerMessage> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async snapshot(): Promise<RoomSnapshot> {
    const message = await this.next();
    if (message.type !== "snapshot") {
      throw new Error(`expected a snapshot, got ${JSON.stringify(message)}`);
    }
    return message.snapshot;
  }
}

let app: App;
const clients: TestClient[] = [];

async function connect(roomId: string): Promise<TestClient> {
  const client = new TestClient(await app.injectWS(socketPath(roomId)));
  clients.push(client);
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `done` holds, up to 2 s, however busy the machine is: a fixed
 * sleep for the sweep timer to run was not always enough with other test
 * files running alongside.
 */
async function until(done: () => boolean): Promise<void> {
  for (let waited = 0; !done() && waited < 2_000; waited += 10) {
    await sleep(10);
  }
}

/** Replaces the default app for a test that needs its own options. */
async function restart(options: ServerOptions): Promise<void> {
  await app.close();
  app = buildServer(options);
  await app.ready();
}

async function createRoom(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/api/rooms" });
  return response.json<{ roomId: string }>().roomId;
}

beforeEach(async () => {
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  await app.close();
});

describe("HTTP routes", () => {
  it("creates a room id that the websocket route accepts", async () => {
    const response = await app.inject({ method: "POST", url: "/api/rooms" });

    expect(response.statusCode).toBe(200);
    const { roomId } = response.json<{ roomId: string }>();
    expect(roomId).toMatch(ROOM_ID_PATTERN);
  });

  it("reports health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("websocket route", () => {
  it("joins two clients, collects votes and reveals them", async () => {
    const roomId = await createRoom();
    const alice = await connect(roomId);
    const bob = await connect(roomId);

    alice.send({ type: "join", sessionToken: randomUUID(), name: "Alice" });
    const aliceView = await alice.snapshot();
    expect(aliceView.participants.map((p) => p.name)).toEqual(["Alice"]);

    bob.send({ type: "join", sessionToken: randomUUID(), name: "Bob" });
    expect((await bob.snapshot()).participants).toHaveLength(2);
    expect((await alice.snapshot()).participants).toHaveLength(2);

    alice.send({ type: "castVote", card: "5" });
    expect(await alice.snapshot()).toMatchObject({ yourVote: "5" });
    expect(await bob.snapshot()).toMatchObject({
      yourVote: null,
      participants: [{ name: "Alice", hasVoted: true }, { hasVoted: false }],
    });

    bob.send({ type: "castVote", card: "8" });
    await bob.snapshot();
    await alice.snapshot();

    bob.send({ type: "reveal" });
    for (const client of [alice, bob]) {
      expect(await client.snapshot()).toMatchObject({
        phase: "revealed",
        participants: [
          { name: "Alice", vote: "5" },
          { name: "Bob", vote: "8" },
        ],
      });
    }
  });

  it("carries a nudge to its target alone, over real sockets", async () => {
    const roomId = await createRoom();
    const alice = await connect(roomId);
    const bob = await connect(roomId);
    const carol = await connect(roomId);
    const joined = async (client: TestClient, name: string, count: number) => {
      client.send({ type: "join", sessionToken: randomUUID(), name });
      let view = await client.snapshot();
      while (view.participants.length < count) view = await client.snapshot();
      return view;
    };
    await joined(alice, "Alice", 1);
    await joined(bob, "Bob", 2);
    const view = await joined(carol, "Carol", 3);
    // Drain the join broadcasts, so each inbox is empty.
    await alice.snapshot();
    await alice.snapshot();
    await bob.snapshot();
    const bobId = view.participants[1]?.id ?? "";

    alice.send({ type: "nudge", participantId: bobId });
    expect(await bob.next()).toEqual({ type: "nudged" });
    // Frames arrive in order: if anything had reached Alice or Carol, it
    // would come before the pong to a ping sent after the nudge.
    for (const client of [alice, carol]) {
      client.send({ type: "ping" });
      expect(await client.next()).toEqual({ type: "pong" });
    }
  });

  it.each(["short", "has.a.dot!", "toolongroomid1"])(
    "rejects the malformed room id %j before upgrade",
    async (roomId) => {
      await expect(app.injectWS(`/ws/${roomId}`)).rejects.toThrow(
        "Unexpected server response: 400",
      );
    },
  );

  it("closes a socket that never joins with JOIN_TIMEOUT, from the sweep timer", async () => {
    let now = 0;
    await restart({ clock: () => now, sweepIntervalMs: 5 });
    const lurker = await connect(await createRoom());

    now += JOIN_TIMEOUT_MS;

    expect(await lurker.closed).toEqual({
      code: CloseCode.JOIN_TIMEOUT,
      reason: "join timeout",
    });
  });

  it("forwards pongs, so a client that answers pings outlives the pong deadline", async () => {
    let now = 0;
    let reads = 0;
    await restart({
      clock: () => {
        reads += 1;
        return now;
      },
      sweepIntervalMs: 5,
    });
    const alice = await connect(await createRoom());
    alice.send({ type: "join", sessionToken: randomUUID(), name: "Alice" });
    await alice.snapshot();

    // Browsers answer pings in the network stack. injectWS's client does not
    // (ws only enables autoPong for clients it dials itself), so answer here.
    const pinged = new Promise((resolve) =>
      alice.socket.once("ping", () => resolve(alice.socket.pong())),
    );
    now = PING_INTERVAL_MS;
    await pinged;
    await sleep(20); // let the pong reach the server
    now = PONG_TIMEOUT_MS; // past the deadline measured from join
    // Until the sweep has run on the new time, twice: without that, the
    // socket being open would prove nothing.
    const before = reads;
    await until(() => reads >= before + 2);
    expect(reads).toBeGreaterThanOrEqual(before + 2);

    expect(alice.socket.readyState).toBe(alice.socket.OPEN);
  });

  it("stops the sweep timer when the server closes", async () => {
    let reads = 0;
    const clock = () => {
      reads += 1;
      return 0;
    };
    await restart({ clock, sweepIntervalMs: 5 });
    await sleep(25);
    expect(reads).toBeGreaterThan(0);

    await app.close();
    const readsAtClose = reads;
    await sleep(25);
    expect(reads).toBe(readsAtClose);
  });

  it.each([
    "",
    "?v=0",
    `?v=${String(PROTOCOL_VERSION - 1)}`, // the client before the last bump
    `?v=${String(PROTOCOL_VERSION + 1)}`,
    `?v=${String(PROTOCOL_VERSION)}.0`,
    `?v=${String(PROTOCOL_VERSION)}&v=${String(PROTOCOL_VERSION)}`,
    `?version=${String(PROTOCOL_VERSION)}`,
  ])(
    "closes a client with protocol %j as OUTDATED_CLIENT, before any room state",
    async (query) => {
      const lines: { type?: string }[] = [];
      await restart({
        logger: {
          stream: {
            write: (line: string) =>
              lines.push(JSON.parse(line) as { type?: string }),
          },
        },
      });
      const roomId = await createRoom();
      const client = new TestClient(
        await app.injectWS(`/ws/${roomId}${query}`),
      );
      clients.push(client);

      // The upgrade succeeds, so the client can read why it was closed.
      expect(await client.closed).toEqual({
        code: CloseCode.OUTDATED_CLIENT,
        reason: "outdated client",
      });
      const types = lines.map((line) => line.type);
      expect(types).toContain("outdated-client");
      expect(types).not.toContain("open"); // RoomService never saw it
    },
  );

  it("logs a bounded summary of a client-supplied version, however large", async () => {
    const lines: { type?: string; version?: unknown }[] = [];
    const raw: string[] = [];
    await restart({
      logger: {
        stream: {
          write: (line: string) => {
            raw.push(line);
            lines.push(
              JSON.parse(line) as { type?: string; version?: unknown },
            );
          },
        },
      },
    });
    const roomId = await createRoom();
    const long = "x".repeat(2_000);
    const repeated = Array.from({ length: 100 }, () => `v=${"y".repeat(100)}`);
    for (const query of [`?v=${long}`, `?${repeated.join("&")}`]) {
      const client = new TestClient(
        await app.injectWS(`/ws/${roomId}${query}`),
      );
      clients.push(client);
      await client.closed;
    }

    const outdated = lines.filter((line) => line.type === "outdated-client");
    expect(outdated.map((line) => line.version)).toEqual([
      "x".repeat(16),
      "[repeated]",
    ]);
    for (const line of raw.filter((l) => l.includes("outdated-client"))) {
      expect(line.length).toBeLessThan(300);
    }
  });

  it("answers an app-level ping with a pong over the socket", async () => {
    const client = await connect(await createRoom());
    client.send({ type: "ping" });
    expect(await client.next()).toEqual({ type: "pong" });
  });

  it("lets a client on the current protocol version join", async () => {
    expect(socketPath("abcdefghijk")).toBe(
      `/ws/abcdefghijk?v=${PROTOCOL_VERSION}`,
    );
    const alice = await connect(await createRoom());
    alice.send({ type: "join", sessionToken: randomUUID(), name: "Alice" });
    expect((await alice.snapshot()).participants).toHaveLength(1);
  });

  it("closes the socket with 1009 when a frame exceeds maxPayload", async () => {
    const client = await connect(await createRoom());

    client.socket.send("x".repeat(4097));

    expect((await client.closed).code).toBe(1009);
  });

  it("lets the largest messages a client can legitimately send through the 4 KiB cap", async () => {
    // The protocol's own caps: a 200-character name and a 200-character
    // ticket, each made of characters JSON escapes to 6 bytes, the most any
    // character costs on the wire, and the longest session token.
    const worst = "\u0001".repeat(200);
    const join = {
      type: "join",
      sessionToken: "T".repeat(64),
      name: worst,
    } as const;
    // Ending in one visible character, so the room has a ticket to show.
    const ticket = {
      type: "setTicket",
      text: `${worst.slice(1)}A`,
    } as const;
    for (const message of [join, ticket]) {
      expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThan(4096);
    }
    const client = await connect(await createRoom());
    client.send(join);
    expect(await client.next()).toEqual({
      type: "error",
      code: "INVALID_NAME",
    });
    client.send({ type: "join", sessionToken: randomUUID(), name: "Ada" });
    await client.snapshot();
    client.send(ticket);
    // The control characters go, and what is left is the ticket: an
    // answer, not a 1009.
    expect((await client.snapshot()).ticket).toBe("A");
  });

  it("caps the oversized-frame warning for the whole server, not per connection (#16)", async () => {
    const FRAMES = 10_000;
    const lines: Record<string, unknown>[] = [];
    let now = 0;
    await restart({
      clock: () => now,
      sweepIntervalMs: 5,
      // Not what this test is about: the server notices each socket's close
      // a moment after the client does, so a batch can briefly hold more
      // than the 1,000 unjoined sockets allowed.
      limits: { maxPending: FRAMES },
      logger: {
        level: "warn",
        stream: {
          write: (line: string) =>
            lines.push(JSON.parse(line) as Record<string, unknown>),
        },
      },
    });
    const roomId = await createRoom();
    // Each on a fresh connection, since each closes its own: 10,000 in a
    // minute, in batches.
    for (let sent = 0; sent < FRAMES; sent += 250) {
      await Promise.all(
        Array.from({ length: 250 }, async () => {
          const client = new TestClient(await app.injectWS(socketPath(roomId)));
          client.socket.send("x".repeat(4097));
          expect((await client.closed).code).toBe(1009);
        }),
      );
    }
    const warnings = () => lines.filter((l) => l.msg === "websocket error");
    expect(warnings()).toHaveLength(10);
    // A minute after the first was held back, the count goes out, once.
    now += 60_000;
    await until(() => lines.some((l) => l.type === "suppressed"));
    expect(lines.filter((l) => l.type === "suppressed")).toEqual([
      expect.objectContaining({
        type: "suppressed",
        line: "websocket error",
        count: FRAMES - 10,
      }),
    ]);
    expect(warnings()).toHaveLength(10);
  }, 60_000);
});

describe("logging", () => {
  it("keeps room ids and session tokens out of every log line (#21)", async () => {
    const lines: Record<string, unknown>[] = [];
    await restart({
      logger: {
        stream: {
          write: (line: string) =>
            lines.push(JSON.parse(line) as Record<string, unknown>),
        },
      },
    });

    const roomId = await createRoom();
    const [aliceToken, bobToken] = [randomUUID(), randomUUID()];
    const alice = await connect(roomId);
    alice.send({ type: "join", sessionToken: aliceToken, name: "Alice" });
    await alice.snapshot();
    const bob = await connect(roomId);
    bob.send({ type: "join", sessionToken: bobToken, name: "Bob" });
    await bob.snapshot();
    alice.send({ type: "castVote", card: "5" });
    bob.send({ type: "reveal" });
    await bob.snapshot();
    const aliceTab2 = await connect(roomId);
    aliceTab2.send({ type: "join", sessionToken: aliceToken, name: "Alice" });
    await alice.closed; // superseded
    await expect(app.injectWS("/ws/not-a-room")).rejects.toThrow("400");
    await app.inject({ method: "GET", url: `/ws/${roomId}/unknown` });
    const flooder = await connect(roomId); // the warn path an attacker can trigger
    flooder.socket.send("x".repeat(4097));
    expect((await flooder.closed).code).toBe(1009);
    await app.close();

    expect(lines.filter((line) => line.level === 40)).toHaveLength(1);
    const text = JSON.stringify(lines);
    for (const secret of [roomId, aliceToken, bobToken]) {
      expect(text).not.toContain(secret);
    }
    const urls = new Set(
      lines.flatMap((line) => {
        const req = line.req as { url?: string } | undefined;
        return req?.url ? [req.url] : [];
      }),
    );
    expect(urls).toEqual(new Set(["/api/rooms", "/ws/:roomId", "(unmatched)"]));
    const rooms = new Set(
      lines.flatMap((line) => (line.room ? [line.room] : [])),
    );
    expect(rooms).toEqual(new Set([roomLogId(roomId)]));
    // No "close": injectWS's in-memory streams never emit a server-side close.
    // The close path is covered in room-service.test.ts.
    const types = new Set(lines.map((line) => line.type));
    for (const type of ["open", "join", "castVote", "reveal", "supersede"]) {
      expect(types).toContain(type);
    }
  });
});

describe("the ticket over real sockets", () => {
  it("reaches everyone in the room, and never appears in a log line", async () => {
    const lines: Record<string, unknown>[] = [];
    await restart({
      logger: {
        stream: {
          write: (line: string) =>
            lines.push(JSON.parse(line) as Record<string, unknown>),
        },
      },
    });
    const roomId = await createRoom();
    const alice = await connect(roomId);
    alice.send({ type: "join", sessionToken: randomUUID(), name: "Alice" });
    await alice.snapshot();
    const bob = await connect(roomId);
    bob.send({ type: "join", sessionToken: randomUUID(), name: "Bob" });
    await bob.snapshot();
    await alice.snapshot();

    const text = "PROJ-482 Quietly-logged-ticket-text";
    alice.send({ type: "setTicket", text });
    expect((await alice.snapshot()).ticket).toBe(text);
    expect((await bob.snapshot()).ticket).toBe(text);

    alice.send({ type: "setTicket", text: "x".repeat(121) });
    expect(await alice.next()).toEqual({
      type: "error",
      code: "TICKET_TOO_LONG",
    });
    await app.close();

    // The message type is logged, as for every message; the text never is.
    expect(lines.map((line) => line.type)).toContain("setTicket");
    expect(JSON.stringify(lines)).not.toContain("Quietly-logged-ticket-text");
    expect(JSON.stringify(lines)).not.toContain("x".repeat(121));
  });
});

describe("failure containment", () => {
  const boom = () => {
    throw new Error("socket gone");
  };

  it("toConnection never throws, and logs each failed socket call at warn", () => {
    const warnings: { op?: string }[] = [];
    const socket = {
      send: boom,
      close: boom,
      ping: boom,
      terminate: boom,
      bufferedAmount: 0,
    };
    const conn = toConnection(socket, "req-1", {
      warn: (fields: { op?: string }) => warnings.push(fields),
    });

    expect(() => {
      conn.send({ type: "error", code: "NOT_JOINED" });
      conn.close(CloseCode.JOIN_TIMEOUT, "join timeout");
      conn.ping();
      conn.terminate();
    }).not.toThrow();
    expect(warnings.map((fields) => fields.op)).toEqual([
      "send",
      "close",
      "ping",
      "terminate",
    ]);
  });

  it("drops a socket that has stopped reading, once, instead of queueing more for it", () => {
    const sent: string[] = [];
    let terminated = 0;
    let slow = 0;
    const socket = {
      bufferedAmount: 0,
      send: (data: string) => sent.push(data),
      close: () => {},
      ping: () => {},
      terminate: () => {
        terminated += 1;
      },
    };
    const conn = toConnection(socket, "req-1", { warn: () => {} }, () => {
      slow += 1;
    });
    const message = { type: "error", code: "NOT_JOINED" } as const;
    // A slow phone with a few snapshots waiting is sent to as usual.
    socket.bufferedAmount = MAX_BUFFERED_BYTES;
    conn.send(message);
    expect(sent).toHaveLength(1);
    // Past 1 MiB unread: dropped, not sent to, and said once.
    socket.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    conn.send(message);
    conn.send(message);
    expect(sent).toHaveLength(1);
    expect([terminated, slow]).toEqual([1, 1]);
  });

  it("forgets a dropped slow socket everywhere, through the room service's close", () => {
    const service = new RoomService(() => 0, {
      maxRooms: 10,
      maxPending: 10,
    });
    const make = (id: string) => {
      const socket = {
        bufferedAmount: 0,
        send: () => {},
        close: () => {},
        ping: () => {},
        // ws fires close after terminate, and the route passes it on.
        terminate: () => service.close(conn),
      };
      const conn = toConnection(socket, id, { warn: () => {} });
      return { socket, conn };
    };
    const reader = make("reader");
    const stalled = make("stalled");
    for (const { conn } of [reader, stalled]) {
      service.open(conn, "abcdefghijk");
      service.message(
        conn,
        JSON.stringify({
          type: "join",
          sessionToken: randomUUID(),
          name: conn.id,
        }),
      );
    }
    stalled.socket.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    // The reader's next move sends the stalled socket a snapshot: dropped.
    service.message(
      reader.conn,
      JSON.stringify({ type: "castVote", card: "5" }),
    );
    service.message(reader.conn, JSON.stringify({ type: "leave" }));
    service.close(reader.conn);
    const counts = service.bookkeeping();
    expect({
      pending: counts.pending,
      bindings: counts.bindings,
      sockets: counts.sockets,
      socketRooms: counts.socketRooms,
      lastSent: counts.lastSent,
      liveness: counts.liveness,
      throttles: counts.throttles,
    }).toEqual({
      pending: 0,
      bindings: 0,
      sockets: 0,
      socketRooms: 0,
      lastSent: 0,
      liveness: 0,
      throttles: 0,
    });
  });

  it("a socket whose close throws does not stop the sweep closing the rest", () => {
    let now = 0;
    const service = new RoomService(() => now, {
      maxRooms: 10,
      maxPending: 10,
    });
    const closed: string[] = [];
    const quiet = { warn: () => {} };
    const sockets = ["broken", "second", "third"].map((id) => ({
      id,
      bufferedAmount: 0,
      send: () => {},
      ping: () => {},
      terminate: () => {},
      close: id === "broken" ? boom : () => closed.push(id),
    }));
    for (const socket of sockets) {
      service.open(toConnection(socket, socket.id, quiet), "abcdefghijk");
    }

    now += JOIN_TIMEOUT_MS;
    expect(() => service.sweep()).not.toThrow();
    expect(closed).toEqual(["second", "third"]);
  });

  it("keeps the server running when a sweep throws", async () => {
    const lines: { level?: number; msg?: string }[] = [];
    let reads = 0;
    const clock = () => {
      reads += 1;
      if (reads === 1) throw new Error("clock broke");
      return 0;
    };
    await restart({
      clock,
      sweepIntervalMs: 5,
      logger: {
        stream: {
          write: (line: string) =>
            lines.push(JSON.parse(line) as { level?: number; msg?: string }),
        },
      },
    });
    // Until a later tick has run.
    await until(() => reads >= 3);

    expect(lines.filter((line) => line.msg === "sweep failed")).toEqual([
      expect.objectContaining({ level: 50 }),
    ]);
    expect(reads).toBeGreaterThan(1); // later ticks still ran
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });
});
