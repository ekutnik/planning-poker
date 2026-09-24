import websocket from "@fastify/websocket";
import Fastify, { type FastifyServerOptions } from "fastify";
import { generateRoomId, ROOM_ID_PATTERN } from "./identity.js";
import { RoomService, type Connection } from "./room-service.js";

export interface ServerOptions {
  readonly logger?: FastifyServerOptions["logger"];
  readonly maxRooms?: number;
  readonly clock?: () => number;
}

const roomParams = {
  type: "object",
  properties: { roomId: { type: "string", pattern: ROOM_ID_PATTERN.source } },
  required: ["roomId"],
} as const;

/**
 * A configured Fastify instance that does not listen; callers own the lifecycle.
 * The websocket route is a thin adapter: each socket becomes a Connection and
 * every decision lives in RoomService. If this grows, logic has leaked out.
 */
export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  const rooms = new RoomService(
    options.clock ?? Date.now,
    { maxRooms: options.maxRooms ?? 10_000 },
    { info: (fields) => app.log.info(fields) },
  );

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
    scope.get<{ Params: { roomId: string } }>(
      "/ws/:roomId",
      { websocket: true, schema: { params: roomParams } },
      (socket, request) => {
        const conn: Connection = {
          id: request.id,
          send: (message) => socket.send(JSON.stringify(message)),
          close: (code, reason) => socket.close(code, reason),
        };
        rooms.open(conn, request.params.roomId);
        // Never log `data`: a join frame carries the session token.
        socket.on("message", (data: Buffer) =>
          rooms.message(conn, data.toString("utf8")),
        );
        socket.on("close", () => rooms.close(conn));
      },
    );
    done();
  });

  return app;
}
