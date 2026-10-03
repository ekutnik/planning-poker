import websocket from "@fastify/websocket";
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyLoggerOptions,
  type FastifyRequest,
} from "fastify";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import { CloseCode } from "../shared/close-codes.js";
import { PROTOCOL_VERSION } from "../shared/protocol.js";
import { ROOM_ID_PATTERN } from "../shared/rules.js";
import { clientIp, type Proxy } from "./client-ip.js";
import { securityHeaders } from "./headers.js";
import { generateRoomId } from "./identity.js";
import {
  DEFAULT_LIMITS,
  RoomService,
  SWEEP_INTERVAL_MS,
  type Connection,
  type Limits,
} from "./room-service.js";
import { AddressLimits } from "./limits/address.js";
import { limitKey } from "./limits/limit-key.js";
import { LogCaps } from "./limits/log-cap.js";
import { CLOSE_GRACE_MS } from "./shutdown.js";
import { notFound, serveClient } from "./web.js";

export interface ServerOptions {
  /** Omit to disable logging; `stream` lets tests capture the lines. */
  readonly logger?: {
    readonly level?: string;
    readonly stream?: FastifyLoggerOptions["stream"];
  };
  readonly limits?: Partial<Limits>;
  readonly clock?: () => number;
  readonly sweepIntervalMs?: number;
  readonly roomTtlMs?: number;
  /**
   * The built client (dist/web) to serve. Omitted, the server is the API
   * and the websocket alone, as in development, where Vite serves the page.
   */
  readonly webRoot?: string;
  /** Production: adds HSTS (headers.ts). */
  readonly production?: boolean;
  /** The proxy in front, whose header names the client (client-ip.ts). */
  readonly proxy?: Proxy;
  /** For tests that read the per-address counts; built from `limits` otherwise. */
  readonly addressLimits?: AddressLimits;
}

/**
 * Requests a client can make as fast as it likes, each refused in a moment
 * once over its limit (ADR 0009): WebSocket upgrades, and room ids from the
 * API. Fastify would log each one as it arrives, whatever the limit says,
 * so one client could write a line per attempt without end. Their own
 * handlers write the same line instead: always for one the limits accept,
 * and within the server-wide cap for one they refuse.
 *
 * Chosen by the route Fastify matched, never by the request alone: a header
 * or a query string must not be a way to keep any other request out of the
 * log. The socket route also needs the upgrade itself, since a plain GET to
 * it reaches no handler that would write the line.
 */
function loggedByHandler(request: FastifyRequest): boolean {
  const route = request.routeOptions.url;
  if (route === "/api/rooms") return request.method === "POST";
  return (
    route === "/ws/:roomId" &&
    request.headers.upgrade?.toLowerCase() === "websocket"
  );
}

const roomParams = {
  type: "object",
  properties: { roomId: { type: "string", pattern: ROOM_ID_PATTERN.source } },
  required: ["roomId"],
} as const;

/**
 * Fastify's default request serializer logs the raw URL, and `/ws/:roomId` puts
 * a join link there (#21). Log the matched route pattern instead, and the
 * client's address as the proxy in front reports it.
 */
function requestSerializer(proxy: Proxy | undefined) {
  return (request: FastifyRequest) => ({
    method: request.method,
    url: request.routeOptions.url ?? "(unmatched)",
    remoteAddress: clientIp(request, proxy),
  });
}

type Socket = Pick<
  WebSocket,
  "send" | "close" | "ping" | "terminate" | "bufferedAmount"
>;

/**
 * What one socket may hold unsent before it is dropped: a client that has
 * stopped reading. Send buffers live outside the JavaScript heap, so the
 * heap cap does not bound them, and a socket that never reads would grow
 * without limit, at however many snapshots its room sends. A snapshot is
 * a few KB; the largest a room can make measured 8,100 bytes (30 people
 * with 32-character names that JSON escapes to 6 bytes a character, a
 * 120-character ticket of the same, scores on, every vote revealed). So
 * 1 MiB is at least 129 snapshots unread: a dead or hostile client, never
 * a slow phone.
 */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

/**
 * Wraps a socket as a Connection that never throws, as the interface requires.
 * RoomService calls out to connections mid-loop (sweep, broadcast, supersede);
 * a throw there would skip the rest of the loop or, from the sweep interval,
 * crash the process and every room in it. A failed call is logged at warn.
 *
 * A socket holding more than MAX_BUFFERED_BYTES unsent is terminated
 * instead of sent to, once, and `onSlowConsumer` says so. Its close then
 * goes through the room service like any other dropped socket.
 */
export function toConnection(
  socket: Socket,
  id: string,
  log: Pick<FastifyBaseLogger, "warn">,
  onSlowConsumer: () => void = () => {},
): Connection {
  const guard = (op: string, call: () => void) => {
    try {
      call();
    } catch (err) {
      log.warn({ err, conn: id, op }, "socket call failed");
    }
  };
  let dropped = false;
  return {
    id,
    send: (message) => {
      if (dropped) return;
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        dropped = true;
        onSlowConsumer();
        guard("terminate", () => socket.terminate());
        return;
      }
      guard("send", () => socket.send(JSON.stringify(message)));
    },
    close: (code, reason) => guard("close", () => socket.close(code, reason)),
    ping: () => guard("ping", () => socket.ping()),
    terminate: () => guard("terminate", () => socket.terminate()),
  };
}

/**
 * A configured Fastify instance that does not listen; callers own the lifecycle.
 * The websocket route is a thin adapter: each socket becomes a Connection and
 * every decision lives in RoomService. If this grows, logic has leaked out.
 */
export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({
    logger: options.logger && {
      ...options.logger,
      serializers: { req: requestSerializer(options.proxy) },
    },
    // At close, after the preClose drain below, end every HTTP connection
    // still open. By then the rooms are gone, and what remains is idle or,
    // like a browser's preconnect, never sent a request: the HTTP server
    // counts that as neither, so close() would wait for it until the
    // shutdown timeout. Chrome preconnects, so a real deploy would too.
    forceCloseConnections: true,
    logController: new LogController({
      disableRequestLogging: loggedByHandler,
    }),
  });
  securityHeaders(app, { production: options.production ?? false });
  if (options.webRoot !== undefined) serveClient(app, options.webRoot);
  // The default 404 handler logs the raw URL; this one does not.
  app.setNotFoundHandler(notFound(options.webRoot !== undefined));
  const sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  const clock = options.clock ?? Date.now;
  // One cap per kind of line a client can make the server write, for the
  // whole server (#16): the oversized-frame warning here, and the limits'
  // own lines in the service.
  const logCaps = new LogCaps();
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const address = options.addressLimits ?? new AddressLimits(limits);
  const rooms = new RoomService(clock, limits, {
    log: {
      info: (fields) => app.log.info(fields),
      warn: (fields) => app.log.warn(fields),
    },
    sweepIntervalMs,
    roomTtlMs: options.roomTtlMs,
    logCaps,
  });

  // One interval drives every timeout; there are no per-connection timers.
  let sweeper: NodeJS.Timeout | undefined;
  app.addHook("onReady", (done) => {
    sweeper = setInterval(() => {
      // A throw from the service is a bug: log it loudly, but don't let one
      // bug crash the process and drop every room with it.
      try {
        rooms.sweep();
        address.sweep(clock());
        // Whatever the caps held back, once a minute after it started.
        for (const { line, count } of logCaps.due(clock())) {
          app.log.warn({ type: "suppressed", line, count });
        }
      } catch (err) {
        app.log.error(err, "sweep failed");
      }
    }, sweepIntervalMs);
    done();
  });
  app.addHook("onClose", (_instance, done) => {
    clearInterval(sweeper);
    done();
  });

  // Shutdown (#29). Added here, before the websocket plugin loads, so it
  // runs before the plugin's own preClose, which would close every client
  // with no code at all. Every socket gets 1001 from the service; the ones
  // that have not finished closing after the grace period are dropped.
  app.addHook("preClose", (done) => {
    rooms.shutdown();
    // From now on Fastify answers every request with 503 before any hook
    // runs. For a WebSocket upgrade, a browser reconnecting after its 1001,
    // nothing then releases the socket: the HTTP server keeps it half-open,
    // and server.close() would wait for it until the shutdown timeout. This
    // listener comes after the plugin's, which writes the 503 synchronously,
    // so each socket is closed once its answer is written.
    app.server.on("upgrade", (_request, socket: Duplex) => {
      socket.end(() => socket.destroy());
    });
    const open = [...app.websocketServer.clients].filter(
      (socket) => socket.readyState !== socket.CLOSED,
    );
    if (open.length === 0) {
      done();
      return;
    }
    const drop = setTimeout(() => {
      for (const socket of open) socket.terminate();
    }, CLOSE_GRACE_MS);
    let closing = open.length;
    for (const socket of open) {
      socket.once("close", () => {
        closing -= 1;
        if (closing > 0) return;
        clearTimeout(drop);
        done();
      });
    }
  });

  void app.register(websocket, {
    // ws closes oversized frames with 1009 before they reach the parser.
    options: { maxPayload: 4096 },
    // Socket errors are almost always a misbehaving client, not a server fault.
    // Log at warn, within the server-wide cap, since each oversized frame
    // closes its own connection and the next can come on a fresh one; let a
    // close ws has already begun (1009) finish cleanly.
    errorHandler: (error, socket, request) => {
      if (logCaps.allow("websocket error", clock())) {
        request.log.warn({ err: error }, "websocket error");
      }
      if (socket.readyState === socket.OPEN) socket.terminate();
    },
  });

  app.get("/health", () => ({ status: "ok" }));
  /** The request's own line, as Fastify would have written it. */
  const requestLine = (request: FastifyRequest) => {
    request.log.info({ req: request }, "incoming request");
  };

  /**
   * One capped line for a per-address refusal, with the request's own line
   * before it, which carries the address; the limit's line never does.
   */
  const limitedLine = (
    take: "limited" | "full",
    limit: string,
    request: FastifyRequest,
  ) => {
    const now = clock();
    if (take === "full") {
      if (logCaps.allow("limiter full", now)) {
        requestLine(request);
        app.log.warn({ type: "limiter-full", limit });
      }
    } else if (logCaps.allow("rate-limited", now)) {
      requestLine(request);
      app.log.info({ type: "rate-limited", limit, conn: request.id });
    }
  };

  // Only makes up an id: a room exists once someone joins it, and that is
  // where creating one is counted (ADR 0009). The id itself is limited per
  // address like an upgrade, and the request has no body to speak of.
  app.post("/api/rooms", { bodyLimit: 1024 }, (request, reply) => {
    const key = limitKey(clientIp(request, options.proxy));
    const { take, retryAfterMs } = address.roomId(key, clock());
    if (take !== "ok") {
      limitedLine(take, "room-ids", request);
      return reply
        .code(429)
        .header(
          "Retry-After",
          String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
        )
        .send({ error: "RATE_LIMITED" });
    }
    requestLine(request);
    return { roomId: generateRoomId() };
  });

  // A child plugin loads after the websocket plugin, so its onRoute hook sees
  // this route. The params schema rejects a malformed room id with 400 before upgrade.
  void app.register((scope, _opts, done) => {
    scope.get<{ Params: { roomId: string }; Querystring: { v?: unknown } }>(
      "/ws/:roomId",
      { websocket: true, schema: { params: roomParams } },
      (socket, request) => {
        const conn = toConnection(socket, request.id, request.log, () => {
          if (logCaps.allow("slow consumer", clock())) {
            request.log.warn({ type: "slow-consumer", conn: request.id });
          }
        });
        const key = limitKey(clientIp(request, options.proxy));
        // Per address (ADR 0009), checked after the upgrade for the reason
        // below: 1013, which the client retries with its long backoff. The
        // upgrade rate first, for every attempt, outdated clients too.
        const upgrade = address.upgrade(key, clock());
        if (upgrade !== "ok") {
          limitedLine(upgrade, "upgrades", request);
          conn.close(1013, "try again later"); // standard: Try Again Later
          return;
        }
        requestLine(request);
        // Checked after upgrade, not in the schema: a browser cannot read the
        // HTTP status of a failed upgrade, only a close code (#17). An outdated
        // client never reaches the service, so no room state is touched.
        const version = request.query.v;
        if (version !== String(PROTOCOL_VERSION)) {
          // Client-supplied, so log a bounded summary: a repeated parameter
          // arrives as an array and could otherwise put ~16 KB in the log.
          const seen =
            typeof version === "string"
              ? version.slice(0, 16)
              : Array.isArray(version)
                ? "[repeated]"
                : typeof version;
          request.log.info({ type: "outdated-client", version: seen });
          conn.close(CloseCode.OUTDATED_CLIENT, "outdated client");
          return;
        }
        const room = address.roomForSocket(key);
        if (room !== "ok") {
          limitedLine(room, "sockets", request);
          conn.close(1013, "try again later");
          return;
        }
        // The count's only two writers, so it cannot leak: one more now, and
        // one fewer from this socket's own close, which ws fires exactly
        // once, whatever closes it.
        address.open(key);
        socket.once("close", () => address.close(key));
        rooms.open(conn, request.params.roomId, key);
        // Never log `data`: a join frame carries the session token.
        socket.on("message", (data: Buffer) =>
          rooms.message(conn, data.toString("utf8")),
        );
        socket.on("pong", () => rooms.pong(conn));
        socket.on("close", () => rooms.close(conn));
      },
    );
    done();
  });

  return app;
}
