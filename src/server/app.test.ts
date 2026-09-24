import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { buildServer, toConnection, type ServerOptions } from "./app.js";
import { CloseCode } from "../shared/close-codes.js";
import { ROOM_ID_PATTERN, roomLogId } from "./identity.js";
import { JOIN_TIMEOUT_MS, RoomService } from "./room-service.js";

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
  const client = new TestClient(await app.injectWS(`/ws/${roomId}`));
  clients.push(client);
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it("closes the socket with 1009 when a frame exceeds maxPayload", async () => {
    const client = await connect(await createRoom());

    client.socket.send("x".repeat(4097));

    expect((await client.closed).code).toBe(1009);
  });
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

describe("failure containment", () => {
  const boom = () => {
    throw new Error("socket gone");
  };

  it("toConnection never throws, and logs each failed socket call at warn", () => {
    const warnings: { op?: string }[] = [];
    const socket = { send: boom, close: boom, ping: boom, terminate: boom };
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
    await sleep(30);

    expect(lines.filter((line) => line.msg === "sweep failed")).toEqual([
      expect.objectContaining({ level: 50 }),
    ]);
    expect(reads).toBeGreaterThan(1); // later ticks still ran
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
  });
});
