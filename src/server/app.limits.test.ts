import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { CloseCode } from "../shared/close-codes.js";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import { socketPath } from "../shared/socket.js";
import { buildServer, type ServerOptions } from "./app.js";
import { AddressLimits } from "./limits/address.js";
import { DEFAULT_LIMITS, JOIN_TIMEOUT_MS } from "./room-service.js";

/**
 * The limits per client address over real sockets (ADR 0009): where the
 * upgrade handler checks them, what a refused client gets, that the key
 * can't be spoofed, and that the open-socket count can never leak.
 */

type App = ReturnType<typeof buildServer>;
let app: App | null = null;
/** Set when a test listens on a real port: sockets then go over TCP. */
let port: number | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
  port = null;
});

class Client {
  readonly received: ServerMessage[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  constructor(readonly socket: WebSocket) {
    socket.on("message", (data: Buffer) => {
      this.received.push(JSON.parse(data.toString("utf8")) as ServerMessage);
    });
    this.closed = new Promise((resolve) => {
      socket.on("close", (code, reason) =>
        resolve({ code, reason: reason.toString("utf8") }),
      );
    });
  }
  send(message: ClientMessage | string): void {
    this.socket.send(
      typeof message === "string" ? message : JSON.stringify(message),
    );
  }
  async until(type: ServerMessage["type"]): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      if (this.received.some((message) => message.type === type)) return;
      await sleep(5);
    }
    throw new Error(`no ${type}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ROOM = "abcdefghijk";

async function start(options: ServerOptions = {}): Promise<App> {
  app = buildServer({ proxy: "fly", ...options });
  await app.ready();
  return app;
}

/** A socket from `address`, as Fly's proxy names it. */
async function from(
  address: string,
  path = socketPath(ROOM),
  headers: Record<string, string> = {},
): Promise<Client> {
  if (app === null) throw new Error("no app");
  if (port !== null) {
    // A real socket, whose close the server hears as a real one does.
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`, {
      headers: { "fly-client-ip": address, ...headers },
    });
    const client = new Client(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return client;
  }
  return new Client(
    await app.injectWS(path, {
      headers: { "fly-client-ip": address, ...headers },
    }),
  );
}

/** Waits for `check` to hold, up to a few seconds. */
async function eventually(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !check(); i += 1) await sleep(10);
}

/** Lines the app logged, parsed. */
function capture(): {
  lines: Record<string, unknown>[];
  logger: ServerOptions["logger"];
} {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    logger: {
      stream: {
        write: (line: string) =>
          lines.push(JSON.parse(line) as Record<string, unknown>),
      },
    },
  };
}

describe("upgrades per address", () => {
  it("closes the 61st upgrade in a minute from one address with 1013, before the room service sees it", async () => {
    const { lines, logger } = capture();
    await start({ logger });
    const first = await Promise.all(
      Array.from({ length: 60 }, () => from("203.0.113.7")),
    );
    const refused = await from("203.0.113.7");
    expect(await refused.closed).toEqual({
      code: 1013,
      reason: "try again later",
    });
    expect(lines.filter((line) => line.type === "open")).toHaveLength(60);
    expect(lines).toContainEqual(
      expect.objectContaining({ type: "rate-limited", limit: "upgrades" }),
    );
    // No line names the address the limit counted.
    expect(
      lines.filter(
        (line) =>
          line.type === "rate-limited" &&
          JSON.stringify(line).includes("203.0.113.7"),
      ),
    ).toEqual([]);
    for (const client of first) client.socket.terminate();
  });

  it("lets the same burst through when it comes from two addresses", async () => {
    await start();
    const clients = await Promise.all(
      Array.from({ length: 61 }, (_, i) =>
        from(i % 2 ? "203.0.113.7" : "198.51.100.2"),
      ),
    );
    await sleep(20);
    for (const client of clients) {
      expect(client.socket.readyState).toBe(client.socket.OPEN);
      client.socket.terminate();
    }
  });

  it("counts outdated clients too", async () => {
    await start();
    for (let i = 0; i < 60; i += 1) {
      const old = await from("203.0.113.7", `/ws/${ROOM}?v=2`);
      expect((await old.closed).code).toBe(CloseCode.OUTDATED_CLIENT);
    }
    expect((await (await from("203.0.113.7")).closed).code).toBe(1013);
  });
});

describe("the key can't be chosen by the client", () => {
  it("ignores Fly-Client-IP when the server isn't behind Fly", async () => {
    await start({ proxy: undefined });
    // Every request names a different address; none of them counts.
    const clients = await Promise.all(
      Array.from({ length: 60 }, (_, i) => from(`198.51.100.${String(i)}`)),
    );
    expect((await (await from("203.0.113.99")).closed).code).toBe(1013);
    for (const client of clients) client.socket.terminate();
  });

  it("ignores X-Forwarded-For behind Fly: only Fly-Client-IP names the client", async () => {
    await start();
    const clients = await Promise.all(
      Array.from({ length: 60 }, (_, i) =>
        from("203.0.113.7", socketPath(ROOM), {
          "x-forwarded-for": `198.51.100.${String(i)}`,
        }),
      ),
    );
    const refused = await from("203.0.113.7", socketPath(ROOM), {
      "x-forwarded-for": "192.0.2.1",
    });
    expect((await refused.closed).code).toBe(1013);
    for (const client of clients) client.socket.terminate();
  });
});

describe("open sockets per address", () => {
  it("closes the 101st open socket from one address with 1013", async () => {
    // A minute's upgrades raised, so this test meets only the socket limit.
    await start({ limits: { connectsPerMinute: 1_000 } });
    const open = await Promise.all(
      Array.from({ length: 100 }, () => from("203.0.113.7")),
    );
    expect((await (await from("203.0.113.7")).closed).code).toBe(1013);
    open[0]?.socket.terminate();
    await open[0]?.closed;
    await sleep(10);
    const another = await from("203.0.113.7");
    await sleep(10);
    expect(another.socket.readyState).toBe(another.socket.OPEN);
    for (const client of [...open, another]) client.socket.terminate();
  });

  it("returns to 0 after 1,000 sockets close, by every way a socket can close", async () => {
    let now = 0;
    const address = new AddressLimits({
      connectsPerMinute: DEFAULT_LIMITS.connectsPerMinute,
      socketsPerAddress: 5,
    });
    await start({
      clock: () => now,
      sweepIntervalMs: 5,
      addressLimits: address,
      limits: { socketsPerAddress: 5, maxPending: 2_000, maxRooms: 5_000 },
    });
    // Over TCP: the in-process sockets never tell the server that a client
    // went, so a terminated one would wait out ws's 30 s close timeout.
    await app?.listen({ port: 0, host: "127.0.0.1" });
    const bound = app?.server.address();
    port = typeof bound === "object" && bound !== null ? bound.port : null;
    // A room each, since a room holds 30 people and someone who drops
    // stays in it for the grace period.
    let rooms = 0;
    const room = () => {
      rooms += 1;
      return socketPath(`r${String(rooms).padStart(10, "0")}`);
    };
    // Each socket from an address of its own, unless a path needs one.
    let next = 0;
    const fresh = () => {
      next += 1;
      return `10.${String(next >> 16)}.${String((next >> 8) & 255)}.${String(next & 255)}`;
    };
    const join = async (client: Client, token = randomUUID()) => {
      client.send({ type: "join", sessionToken: token, name: "Ada" });
      await client.until("snapshot");
    };
    const PER_PATH = 125;
    const closes: Promise<{ code: number }>[] = [];

    // 1. Leave.
    for (let i = 0; i < PER_PATH; i += 1) {
      const client = await from(fresh(), room());
      await join(client);
      client.send({ type: "leave" });
      closes.push(client.closed);
    }
    // 2. Terminated by the client: no close frame at all.
    for (let i = 0; i < PER_PATH; i += 1) {
      const client = await from(fresh(), room());
      await join(client);
      client.socket.terminate();
      closes.push(client.closed);
    }
    // 3. Superseded: the same token again, from another socket.
    for (let i = 0; i < PER_PATH; i += 1) {
      const token = randomUUID();
      const path = room();
      const first = await from(fresh(), path);
      await join(first, token);
      const second = await from(fresh(), path);
      await join(second, token);
      closes.push(first.closed);
      second.send({ type: "leave" });
      closes.push(second.closed);
    }
    // 4. Outdated client: closed before it is counted.
    for (let i = 0; i < PER_PATH; i += 1) {
      const client = await from(fresh(), `/ws/${ROOM}?v=2`);
      closes.push(client.closed);
    }
    // 5. 1008: out of strikes.
    for (let i = 0; i < PER_PATH; i += 1) {
      const client = await from(fresh(), room());
      await join(client);
      for (let m = 0; m < 70; m += 1) client.send("flood");
      closes.push(client.closed);
    }
    // 6. 1013: one address over its 5 sockets; the 5 stay open till shutdown.
    const crowded = fresh();
    const kept: Client[] = [];
    for (let i = 0; i < 5; i += 1) {
      const client = await from(crowded, room());
      await join(client);
      kept.push(client);
    }
    for (let i = 0; i < PER_PATH; i += 1) {
      closes.push((await from(crowded, room())).closed);
    }
    // 7. Join timeout, from the sweep.
    const lurkers: Client[] = [];
    for (let i = 0; i < PER_PATH; i += 1)
      lurkers.push(await from(fresh(), room()));
    now += JOIN_TIMEOUT_MS;
    for (const lurker of lurkers) {
      expect((await lurker.closed).code).toBe(CloseCode.JOIN_TIMEOUT);
    }
    const codes = (await Promise.all(closes)).map(({ code }) => code);
    // 8. Shutdown: everything still open gets 1001.
    const stayers: Client[] = [...kept];
    for (let i = 0; i < PER_PATH - kept.length; i += 1) {
      const client = await from(fresh(), room());
      await join(client);
      stayers.push(client);
    }
    await eventually(() => address.bookkeeping().sockets === PER_PATH);
    expect(address.bookkeeping().sockets).toBe(PER_PATH);
    await app?.close();
    app = null;
    for (const stayer of stayers) expect((await stayer.closed).code).toBe(1001);

    expect(new Set(codes)).toEqual(
      new Set([
        1000,
        1006,
        CloseCode.SUPERSEDED,
        CloseCode.OUTDATED_CLIENT,
        1008,
        1013,
      ]),
    );
    expect(
      codes.length + lurkers.length + stayers.length,
    ).toBeGreaterThanOrEqual(1_000);
    expect(address.bookkeeping().sockets).toBe(0);
  }, 60_000);
});

describe("room ids from the API, per address", () => {
  it("answers the 61st in a minute with 429 and a Retry-After in seconds", async () => {
    const server = await start();
    const post = (address: string) =>
      server.inject({
        method: "POST",
        url: "/api/rooms",
        headers: { "fly-client-ip": address },
      });
    for (let i = 0; i < 60; i += 1) {
      expect((await post("203.0.113.7")).statusCode).toBe(200);
    }
    const refused = await post("203.0.113.7");
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBe("1");
    expect(refused.json()).toEqual({ error: "RATE_LIMITED" });
    expect((await post("198.51.100.2")).statusCode).toBe(200);
  });

  it("takes no body to speak of: more than 1 KiB is refused", async () => {
    const server = await start();
    const response = await server.inject({
      method: "POST",
      url: "/api/rooms",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ padding: "x".repeat(2_000) }),
    });
    expect(response.statusCode).toBe(413);
  });
});
