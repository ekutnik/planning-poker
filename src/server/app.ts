import websocket from "@fastify/websocket";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyLoggerOptions,
  type FastifyRequest,
} from "fastify";
import type { WebSocket } from "ws";
import { CloseCode } from "../shared/close-codes.js";
import { PROTOCOL_VERSION } from "../shared/protocol.js";
import { ROOM_ID_PATTERN } from "../shared/rules.js";
import { securityHeaders } from "./headers.js";
import { generateRoomId } from "./identity.js";
import {
  RoomService,
  SWEEP_INTERVAL_MS,
  type Connection,
  type Limits,
} from "./room-service.js";
import { notFound, serveClient } from "./web.js";

export const DEFAULT_LIMITS: Limits = { maxRooms: 10_000, maxPending: 1_000 };

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
}

const roomParams = {
  type: "object",
  properties: { roomId: { type: "string", pattern: ROOM_ID_PATTERN.source } },
  required: ["roomId"],
} as const;

/**
 * Fastify's default request serializer logs the raw URL, and `/ws/:roomId` puts
 * a join link there (#21). Log the matched route pattern instead.
 */
function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: request.routeOptions.url ?? "(unmatched)",
    remoteAddress: request.ip,
  };
}

type Socket = Pick<WebSocket, "send" | "close" | "ping" | "terminate">;

/**
 * Wraps a socket as a Connection that never throws, as the interface requires.
 * RoomService calls out to connections mid-loop (sweep, broadcast, supersede);
 * a throw there would skip the rest of the loop or, from the sweep interval,
 * crash the process and every room in it. A failed call is logged at warn.
 */
export function toConnection(
  socket: Socket,
  id: string,
  log: Pick<FastifyBaseLogger, "warn">,
): Connection {
  const guard = (op: string, call: () => void) => {
    try {
      call();
    } catch (err) {
      log.warn({ err, conn: id, op }, "socket call failed");
    }
  };
  return {
    id,
    send: (message) =>
      guard("send", () => socket.send(JSON.stringify(message))),
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
      serializers: { req: serializeRequest },
    },
  });
  securityHeaders(app);
  if (options.webRoot !== undefined) serveClient(app, options.webRoot);
  // The default 404 handler logs the raw URL; this one does not.
  app.setNotFoundHandler(notFound(options.webRoot !== undefined));
  const sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  const rooms = new RoomService(
    options.clock ?? Date.now,
    { ...DEFAULT_LIMITS, ...options.limits },
    {
      log: {
        info: (fields) => app.log.info(fields),
        warn: (fields) => app.log.warn(fields),
      },
      sweepIntervalMs,
      roomTtlMs: options.roomTtlMs,
    },
  );

  // One interval drives every timeout; there are no per-connection timers.
  let sweeper: NodeJS.Timeout | undefined;
  app.addHook("onReady", (done) => {
    sweeper = setInterval(() => {
      // A throw from the service is a bug: log it loudly, but don't let one
      // bug crash the process and drop every room with it.
      try {
        rooms.sweep();
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

  void app.register(websocket, {
    // ws closes oversized frames with 1009 before they reach the parser.
    options: { maxPayload: 4096 },
    // Socket errors are almost always a misbehaving client, not a server fault.
    // Log at warn, and let a close ws has already begun (1009) finish cleanly.
    errorHandler: (error, socket, request) => {
      request.log.warn({ err: error }, "websocket error");
      if (socket.readyState === socket.OPEN) socket.terminate();
    },
  });

  app.get("/health", () => ({ status: "ok" }));
  app.post("/api/rooms", () => ({ roomId: generateRoomId() }));

  // A child plugin loads after the websocket plugin, so its onRoute hook sees
  // this route. The params schema rejects a malformed room id with 400 before upgrade.
  void app.register((scope, _opts, done) => {
    scope.get<{ Params: { roomId: string }; Querystring: { v?: unknown } }>(
      "/ws/:roomId",
      { websocket: true, schema: { params: roomParams } },
      (socket, request) => {
        const conn = toConnection(socket, request.id, request.log);
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
        rooms.open(conn, request.params.roomId);
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
