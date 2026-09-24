import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import type { RoomSnapshot } from "../shared/snapshot.js";
import { buildServer } from "./app.js";
import { ROOM_ID_PATTERN, roomLogId } from "./identity.js";

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

  it("closes the socket with 1009 when a frame exceeds maxPayload", async () => {
    const client = await connect(await createRoom());

    client.socket.send("x".repeat(4097));

    expect((await client.closed).code).toBe(1009);
  });
});

describe("logging", () => {
  it("keeps room ids and session tokens out of every log line (#21)", async () => {
    const lines: Record<string, unknown>[] = [];
    await app.close();
    app = buildServer({
      logger: {
        stream: {
          write: (line: string) =>
            lines.push(JSON.parse(line) as Record<string, unknown>),
        },
      },
    });
    await app.ready();

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
    await app.close();

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
