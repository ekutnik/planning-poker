import type { ParticipantId } from "../shared/ids.js";
import type {
  ClientMessage,
  ErrorCode,
  ServerMessage,
} from "../shared/protocol.js";
import { parseClientMessage } from "../shared/protocol.js";
import {
  applyCommand,
  createRoom,
  type Command,
  type Room,
} from "./domain/room.js";
import { project } from "./domain/projection.js";
import { derivePublicId } from "./identity.js";

export interface Connection {
  readonly id: string;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** Structured fields only. Raw frames are never logged: join carries the token. */
export interface RoomLog {
  info(fields: {
    conn: string;
    room?: string;
    type?: string;
    code?: string;
  }): void;
}

interface Binding {
  readonly roomId: string;
  readonly participantId: ParticipantId;
}

/**
 * Transport-agnostic room registry. Sockets are a Connection; Fastify is just
 * one adapter. The clock is injected so Session 4 can test timeouts with fake time.
 *
 * Session 4, not built here: a join timeout (~10s) and a cap on pending sockets.
 * An unjoined socket currently sits in `pending` forever.
 */
export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private readonly pending = new Map<Connection, string>();
  private readonly bindings = new Map<Connection, Binding>();
  private readonly current = new Map<string, Map<ParticipantId, Connection>>();
  private readonly lastSent = new Map<Connection, string>();
  private readonly closed = new WeakSet<Connection>();

  constructor(
    private readonly clock: () => number,
    private readonly limits: { readonly maxRooms: number },
    private readonly log: RoomLog = { info() {} },
  ) {}

  open(conn: Connection, roomId: string): void {
    if (this.closed.has(conn) || this.bindings.has(conn)) return;
    this.pending.set(conn, roomId);
    this.log.info({ conn: conn.id, room: roomId, type: "open" });
  }

  message(conn: Connection, raw: string): void {
    const roomId = this.pending.get(conn);
    const binding = this.bindings.get(conn);
    if (roomId === undefined && binding === undefined) return;

    const message = parseClientMessage(raw);
    if (!message) {
      this.sendError(conn, "INVALID_MESSAGE", roomId ?? binding?.roomId);
      return;
    }
    this.log.info({
      conn: conn.id,
      room: roomId ?? binding?.roomId,
      type: message.type,
    });

    if (!binding) {
      if (message.type !== "join" || roomId === undefined) {
        this.sendError(conn, "NOT_JOINED", roomId);
        return;
      }
      this.join(conn, roomId, message.sessionToken, message.name);
      return;
    }
    if (message.type === "join") {
      this.sendError(conn, "ALREADY_JOINED", binding.roomId);
      return;
    }
    this.dispatch(conn, binding, message);
  }

  close(conn: Connection): void {
    if (this.closed.has(conn)) return;
    this.closed.add(conn);

    const binding = this.bindings.get(conn);
    const stillCurrent =
      binding !== undefined &&
      this.current.get(binding.roomId)?.get(binding.participantId) === conn;
    this.forget(conn);
    this.log.info({ conn: conn.id, room: binding?.roomId, type: "close" });
    if (!stillCurrent || !binding) return;

    const room = this.rooms.get(binding.roomId);
    if (!room) return;
    const result = applyCommand(
      room,
      { type: "disconnect", participantId: binding.participantId },
      this.clock(),
    );
    if (!result.ok || result.room === room) return;
    this.rooms.set(binding.roomId, result.room);
    this.broadcast(result.room);
  }

  /** Live connection bookkeeping, so tests can prove close() leaks nothing. */
  bookkeeping(): {
    pending: number;
    bindings: number;
    sockets: number;
    lastSent: number;
  } {
    let sockets = 0;
    for (const room of this.current.values()) sockets += room.size;
    return {
      pending: this.pending.size,
      bindings: this.bindings.size,
      sockets,
      lastSent: this.lastSent.size,
    };
  }

  private join(
    conn: Connection,
    roomId: string,
    sessionToken: string,
    name: string,
  ): void {
    const participantId = derivePublicId(roomId, sessionToken);
    let room = this.rooms.get(roomId);
    if (!room) {
      if (this.rooms.size >= this.limits.maxRooms) {
        this.sendError(conn, "SERVER_FULL", roomId);
        return;
      }
      room = createRoom(roomId);
    }

    const result = applyCommand(
      room,
      { type: "join", participantId, name },
      this.clock(),
    );
    if (!result.ok) {
      this.sendError(conn, result.error, roomId);
      return;
    }

    const next = result.room;
    this.rooms.set(roomId, next);
    this.pending.delete(conn);
    this.bindings.set(conn, { roomId, participantId });

    const sockets =
      this.current.get(roomId) ?? new Map<ParticipantId, Connection>();
    this.current.set(roomId, sockets);
    const previous = sockets.get(participantId);
    sockets.set(participantId, conn);
    if (previous && previous !== conn) {
      // Unbind before close, so the old socket's close handler is not still
      // current and cannot dispatch disconnect (ADR 0006).
      this.bindings.delete(previous);
      this.lastSent.delete(previous);
      this.pending.delete(previous);
      this.log.info({ conn: previous.id, room: roomId, type: "supersede" });
      previous.close(4001, "superseded");
    }

    this.sendSnapshot(conn, next, participantId);
    if (next !== room) this.broadcast(next, conn);
  }

  private dispatch(
    conn: Connection,
    binding: Binding,
    message: Exclude<ClientMessage, { type: "join" }>,
  ): void {
    const room = this.rooms.get(binding.roomId);
    if (!room) return;
    const command = toCommand(message, binding.participantId);
    const result = applyCommand(room, command, this.clock());
    if (!result.ok) {
      this.sendError(conn, result.error, binding.roomId);
      return;
    }
    if (result.room === room) return;

    this.rooms.set(binding.roomId, result.room);
    if (command.type === "leave") {
      this.forget(conn);
      this.broadcast(result.room);
      conn.close(1000, "left");
      return;
    }
    this.broadcast(result.room);
  }

  private broadcast(room: Room, except?: Connection): void {
    const sockets = this.current.get(room.id);
    if (!sockets) return;
    for (const [participantId, conn] of sockets) {
      if (conn === except) continue;
      this.sendSnapshot(conn, room, participantId);
    }
  }

  private sendSnapshot(
    conn: Connection,
    room: Room,
    participantId: ParticipantId,
  ): void {
    const snapshot = project(room, participantId);
    const { version, ...content } = snapshot;
    const key = JSON.stringify(content);
    if (this.lastSent.get(conn) === key) return;
    this.lastSent.set(conn, key);
    conn.send({ type: "snapshot", snapshot });
  }

  private sendError(conn: Connection, code: ErrorCode, room?: string): void {
    this.log.info({ conn: conn.id, room, code });
    conn.send({ type: "error", code });
  }

  private forget(conn: Connection): void {
    const binding = this.bindings.get(conn);
    this.pending.delete(conn);
    this.bindings.delete(conn);
    this.lastSent.delete(conn);
    if (!binding) return;
    const sockets = this.current.get(binding.roomId);
    if (sockets?.get(binding.participantId) === conn) {
      sockets.delete(binding.participantId);
      if (sockets.size === 0) this.current.delete(binding.roomId);
    }
  }
}

function toCommand(
  message: Exclude<ClientMessage, { type: "join" }>,
  participantId: ParticipantId,
): Command {
  switch (message.type) {
    case "castVote":
      return { type: "castVote", participantId, card: message.card };
    case "clearVote":
      return { type: "clearVote", participantId };
    case "reveal":
      return { type: "reveal", participantId };
    case "reset":
      return { type: "reset", participantId };
    case "leave":
      return { type: "leave", participantId };
  }
}
