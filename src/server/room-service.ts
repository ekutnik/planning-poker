import { CloseCode } from "../shared/close-codes.js";
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
import { derivePublicId, roomLogId } from "./identity.js";

/**
 * One client socket, as the service sees it. Implementations must not throw:
 * the service calls these mid-loop (sweep, broadcast, supersede), where a throw
 * would leave later connections unhandled. The adapter catches and logs.
 */
export interface Connection {
  readonly id: string;
  send(message: ServerMessage): void;
  /** Closes with a handshake, so the client receives the code and reason. */
  close(code: number, reason: string): void;
  /** Sends a protocol-level ping. Browsers answer it without running page code. */
  ping(): void;
  /** Drops the socket without a handshake; `close` still follows through RoomService.close. */
  terminate(): void;
}

/** How often the adapter runs sweep() unless told otherwise. */
export const SWEEP_INTERVAL_MS = 5_000;

/**
 * A gap between sweeps longer than this many intervals means the process was
 * paused, not that clients went quiet (#26).
 */
export const STALL_INTERVALS = 2;

/** An unjoined socket is closed after this long (#14). */
export const JOIN_TIMEOUT_MS = 10_000;

/**
 * An empty room is evicted after this long (#18). It can be short: with
 * recreate-on-join (ADR 0001), an old link still works; it just starts empty.
 */
export const ROOM_TTL_MS = 10 * 60_000;

/** A joined connection that has not been pinged for this long is pinged (#13). */
export const PING_INTERVAL_MS = 15_000;

/**
 * A joined connection whose last pong is this old is terminated (#13): about
 * two missed pings. A closed laptop lid or dropped Wi-Fi sends no FIN, so
 * without this the server would treat a half-open socket as live forever.
 */
export const PONG_TIMEOUT_MS = 35_000;

export interface Limits {
  /** Rooms held in memory. A join that would create one more gets SERVER_FULL. */
  readonly maxRooms: number;
  /**
   * Unjoined sockets at once. Beyond this, a new socket is closed with 1013 (#15).
   * Bounds unjoined sockets, not sockets in their closing handshake: ws keeps a
   * closed socket open for up to 30s (its closeTimeout) if the peer never
   * answers. A per-IP connection cap (#16) bounds those.
   */
  readonly maxPending: number;
}

interface LogFields {
  conn?: string;
  room?: string;
  type?: string;
  code?: string;
  gapMs?: number;
}

/**
 * Structured fields only. Raw frames are never logged (join carries the token),
 * and `room` is always a roomLogId, never the room id itself (#21).
 */
export interface RoomLog {
  /** Client behaviour: opens, joins, timeouts, errors sent to a client. */
  info(fields: LogFields): void;
  /** Server health: something about this process needs attention. */
  warn(fields: LogFields): void;
}

const NO_LOG: RoomLog = { info() {}, warn() {} };

/** Wraps a RoomLog so that no level can receive a raw room id (#21). */
export function redactRoomIds(log: RoomLog): RoomLog {
  const scrub = (fields: LogFields): LogFields =>
    fields.room === undefined
      ? fields
      : { ...fields, room: roomLogId(fields.room) };
  return {
    info: (fields) => log.info(scrub(fields)),
    warn: (fields) => log.warn(scrub(fields)),
  };
}

export interface ServiceOptions {
  readonly log?: RoomLog;
  /** The interval the caller runs sweep() at; sets the stall threshold (#26). */
  readonly sweepIntervalMs?: number;
  /** How long a room may stay empty before the sweep evicts it (#18). */
  readonly roomTtlMs?: number;
}

interface Pending {
  readonly roomId: string;
  readonly openedAt: number;
}

interface Liveness {
  lastPingAt: number;
  lastPongAt: number;
}

interface Binding {
  readonly roomId: string;
  readonly participantId: ParticipantId;
}

/**
 * Transport-agnostic room registry. Sockets are a Connection; Fastify is just
 * one adapter. Time comes only from the injected clock, and every time-based
 * rule runs in sweep(), so tests use fake time and no timers.
 */
export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private readonly pending = new Map<Connection, Pending>();
  private readonly bindings = new Map<Connection, Binding>();
  private readonly current = new Map<string, Map<ParticipantId, Connection>>();
  private readonly lastSent = new Map<Connection, string>();
  private readonly liveness = new Map<Connection, Liveness>();
  // When each room became empty. The domain has no timestamp for that; only
  // store() and evict() write it, together with `rooms` (#18).
  private readonly emptySince = new Map<string, number>();
  // Weak on purpose: it dedupes a second close() without keeping any connection
  // alive, so it cannot leak. A WeakSet can't be sized, which is why
  // bookkeeping() doesn't report it.
  private readonly closed = new WeakSet<Connection>();
  // Only the redacted logger is stored. The raw RoomLog never becomes a field,
  // so no method can bypass the redaction and log a room id (#21).
  private readonly log: RoomLog;
  private readonly stallAfterMs: number;
  private readonly roomTtlMs: number;
  private lastSweepAt: number | undefined;

  constructor(
    private readonly clock: () => number,
    private readonly limits: Limits,
    {
      log = NO_LOG,
      sweepIntervalMs = SWEEP_INTERVAL_MS,
      roomTtlMs = ROOM_TTL_MS,
    }: ServiceOptions = {},
  ) {
    this.stallAfterMs = sweepIntervalMs * STALL_INTERVALS;
    this.roomTtlMs = roomTtlMs;
    this.log = redactRoomIds(log);
  }

  open(conn: Connection, roomId: string): void {
    if (this.closed.has(conn) || this.pending.has(conn)) return;
    if (this.bindings.has(conn)) return;
    if (this.pending.size >= this.limits.maxPending) {
      this.log.info({ conn: conn.id, room: roomId, code: "PENDING_FULL" });
      conn.close(1013, "try again later"); // standard: Try Again Later
      return;
    }
    this.pending.set(conn, { roomId, openedAt: this.clock() });
    this.log.info({ conn: conn.id, room: roomId, type: "open" });
  }

  message(conn: Connection, raw: string): void {
    const roomId = this.pending.get(conn)?.roomId;
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
    const now = this.clock();
    const result = applyCommand(
      room,
      { type: "disconnect", participantId: binding.participantId },
      now,
    );
    if (!result.ok || result.room === room) return;
    this.store(result.room, now);
    this.broadcast(result.room);
  }

  /** Records a pong from a joined connection; others are ignored (#13). */
  pong(conn: Connection): void {
    const beat = this.liveness.get(conn);
    if (beat) beat.lastPongAt = this.clock();
  }

  /**
   * Applies every time-based rule against one reading of the clock. The adapter
   * calls this from a single interval; tests advance a fake clock and call it
   * directly. No per-connection timers exist, so no exit path has to cancel one.
   *
   * - Join timeout (#14): close a socket still unjoined after JOIN_TIMEOUT_MS.
   * - Heartbeat (#13): ping a joined connection not pinged for PING_INTERVAL_MS;
   *   terminate one whose last pong is PONG_TIMEOUT_MS old.
   * - Grace removal (#19): propose `expire` for every disconnected participant;
   *   the domain removes those disconnected for DISCONNECT_GRACE_MS.
   * - Room TTL (#18): evict a room that has been empty for roomTtlMs. A room
   *   with participants is never evicted; heartbeat and grace removal make an
   *   abandoned room empty within about 105s.
   *
   * Every rule compares timestamps, never a count of sweeps, so changing the
   * interval changes only the lateness. The cost is precision: a deadline fires
   * up to one sweep interval late. With a 5s interval, the join timeout closes
   * a socket after 10–15s, a silent connection is terminated 35–40s after its
   * last pong, and a disconnected participant is removed 60–65s later.
   *
   * Stall guard (#26): deadlines and their evidence (pongs, joins) arrive
   * through the same event loop, and Node runs an overdue timer before it
   * reads queued I/O. After a pause longer than STALL_INTERVALS intervals,
   * every deadline would look missed. So that sweep enforces none of them and
   * only sends due pings; the next sweep runs after the queue is read.
   */
  sweep(): void {
    const now = this.clock();
    const gapMs = now - (this.lastSweepAt ?? now);
    const stalled = gapMs > this.stallAfterMs;
    this.lastSweepAt = now;
    // A stall is about this server's health, not a client's behaviour.
    if (stalled) this.log.warn({ type: "sweep-stalled", gapMs });

    const expired: [Connection, Pending][] = [];
    if (!stalled) {
      for (const entry of this.pending) {
        if (now - entry[1].openedAt >= JOIN_TIMEOUT_MS) expired.push(entry);
      }
    }
    const silent: Connection[] = [];
    const due: [Connection, Liveness][] = [];
    for (const [conn, beat] of this.liveness) {
      if (!stalled && now - beat.lastPongAt >= PONG_TIMEOUT_MS)
        silent.push(conn);
      else if (now - beat.lastPingAt >= PING_INTERVAL_MS)
        due.push([conn, beat]);
    }

    // The sweep proposes; the domain decides who is past the grace period.
    const expiredRooms: Room[] = [];
    if (!stalled) {
      for (const room of this.rooms.values()) {
        let next = room;
        for (const { id, status } of room.participants.values()) {
          if (status !== "disconnected") continue;
          const command = { type: "expire", participantId: id } as const;
          const result = applyCommand(next, command, now);
          if (result.ok) next = result.room;
        }
        if (next !== room) expiredRooms.push(next);
      }
    }

    const evicted: string[] = [];
    if (!stalled) {
      for (const [roomId, since] of this.emptySince) {
        if (now - since >= this.roomTtlMs) evicted.push(roomId);
      }
    }

    // Mutate fully, then call out: close(), terminate() and send() may
    // re-enter the service. Silent connections are deliberately not forgotten
    // here: terminate() reaches close(), which needs the binding to dispatch
    // disconnect, exactly as for any other dropped socket.
    for (const [conn] of expired) this.pending.delete(conn);
    for (const [, beat] of due) beat.lastPingAt = now;
    for (const roomId of evicted) this.evict(roomId);
    for (const room of expiredRooms) this.store(room, now);

    for (const [conn, { roomId }] of expired) {
      this.log.info({ conn: conn.id, room: roomId, type: "join-timeout" });
      conn.close(CloseCode.JOIN_TIMEOUT, "join timeout");
    }
    for (const [conn] of due) conn.ping();
    for (const conn of silent) {
      const room = this.bindings.get(conn)?.roomId;
      this.log.info({ conn: conn.id, room, type: "heartbeat-timeout" });
      conn.terminate();
    }
    for (const room of expiredRooms) {
      this.log.info({ room: room.id, type: "expire" });
      this.broadcast(room);
    }
    for (const roomId of evicted) {
      this.log.info({ room: roomId, type: "evict" });
    }
  }

  /** Live bookkeeping, so tests can prove nothing leaks: not sockets, not rooms. */
  bookkeeping(): {
    rooms: number;
    emptyRooms: number;
    pending: number;
    bindings: number;
    socketRooms: number;
    sockets: number;
    lastSent: number;
    liveness: number;
  } {
    let sockets = 0;
    for (const room of this.current.values()) sockets += room.size;
    return {
      rooms: this.rooms.size,
      emptyRooms: this.emptySince.size,
      pending: this.pending.size,
      bindings: this.bindings.size,
      // Counted separately from sockets: an empty inner Map left in `current`
      // is a leak too, and a sum of sizes would read it as zero.
      socketRooms: this.current.size,
      sockets,
      lastSent: this.lastSent.size,
      liveness: this.liveness.size,
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

    const now = this.clock();
    const result = applyCommand(
      room,
      { type: "join", participantId, name },
      now,
    );
    if (!result.ok) {
      this.sendError(conn, result.error, roomId);
      return;
    }

    const next = result.room;
    this.store(next, now);
    this.pending.delete(conn);
    this.bindings.set(conn, { roomId, participantId });
    this.liveness.set(conn, { lastPingAt: now, lastPongAt: now });

    const sockets =
      this.current.get(roomId) ?? new Map<ParticipantId, Connection>();
    this.current.set(roomId, sockets);
    const previous = sockets.get(participantId);
    sockets.set(participantId, conn);
    if (previous && previous !== conn) {
      // Unbind before close, so the old socket's close handler is not still
      // current and cannot dispatch disconnect (ADR 0006). forget() leaves
      // `current` alone here, because it already points at the new socket.
      this.forget(previous);
      this.log.info({ conn: previous.id, room: roomId, type: "supersede" });
      previous.close(CloseCode.SUPERSEDED, "superseded");
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
    const now = this.clock();
    const result = applyCommand(room, command, now);
    if (!result.ok) {
      this.sendError(conn, result.error, binding.roomId);
      return;
    }
    if (result.room === room) return;

    this.store(result.room, now);
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

  /**
   * store() and evict() are the only writers of `rooms`, and each updates
   * `emptySince` in the same step, so the two maps cannot drift (#18).
   */
  private store(room: Room, now: number): void {
    this.rooms.set(room.id, room);
    // A room only becomes empty through a write, and an empty room gets no
    // further writes (nobody is left to send a command), so `now` is exactly
    // when it became empty.
    if (room.participants.size > 0) this.emptySince.delete(room.id);
    else this.emptySince.set(room.id, now);
  }

  private evict(roomId: string): void {
    this.rooms.delete(roomId);
    this.emptySince.delete(roomId);
  }

  private forget(conn: Connection): void {
    const binding = this.bindings.get(conn);
    this.pending.delete(conn);
    this.bindings.delete(conn);
    this.lastSent.delete(conn);
    this.liveness.delete(conn);
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
