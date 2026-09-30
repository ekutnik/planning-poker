import type { Card } from "../../shared/deck.js";
import type { ParticipantId } from "../../shared/ids.js";
import type { DomainError } from "../../shared/errors.js";

import { MAX_PARTICIPANTS, validName } from "../../shared/rules.js";

// Defined in src/shared so the client validates exactly as the domain does.
export { MAX_NAME_LENGTH, MAX_PARTICIPANTS } from "../../shared/rules.js";

/**
 * How long a disconnected participant keeps their seat and vote (#19). 60s
 * covers a laptop briefly sleeping or a Wi-Fi handover during discussion, and
 * a reconnect in that window reclaims the seat with the vote. Much longer and
 * someone who has really left holds up every round as "not voted".
 */
export const DISCONNECT_GRACE_MS = 60_000;

export type { ParticipantId };
export type Phase = "voting" | "revealed";

export interface Participant {
  readonly id: ParticipantId;
  readonly name: string;
  readonly vote: Card | null;
  readonly status: "connected" | "disconnected";
  readonly disconnectedAt: number | null;
}

export interface Room {
  readonly id: string;
  readonly phase: Phase;
  readonly participants: ReadonlyMap<ParticipantId, Participant>;
  readonly version: number;
}

export type Command =
  | {
      readonly type: "join";
      readonly participantId: ParticipantId;
      readonly name: string;
    }
  | {
      readonly type: "castVote";
      readonly participantId: ParticipantId;
      readonly card: Card;
    }
  | { readonly type: "clearVote"; readonly participantId: ParticipantId }
  | { readonly type: "reveal"; readonly participantId: ParticipantId }
  | { readonly type: "reset"; readonly participantId: ParticipantId }
  | { readonly type: "disconnect"; readonly participantId: ParticipantId }
  | { readonly type: "leave"; readonly participantId: ParticipantId }
  | { readonly type: "expire"; readonly participantId: ParticipantId };

export type { DomainError };

export type Result =
  | { readonly ok: true; readonly room: Room }
  | { readonly ok: false; readonly error: DomainError };

type CommandOf<T extends Command["type"]> = Extract<Command, { type: T }>;

export function createRoom(id: string): Room {
  return { id, phase: "voting", participants: new Map(), version: 0 };
}

export function applyCommand(
  room: Room,
  command: Command,
  now: number,
): Result {
  switch (command.type) {
    case "join":
      return join(room, command);
    case "castVote":
      return castVote(room, command);
    case "clearVote":
      return clearVote(room, command);
    case "reveal":
      return reveal(room, command);
    case "reset":
      return reset(room, command);
    case "disconnect":
      return disconnect(room, command, now);
    case "leave":
      return leave(room, command);
    case "expire":
      return expire(room, command, now);
    default: {
      const unreachable: never = command;
      throw new Error(`Unhandled command: ${JSON.stringify(unreachable)}`);
    }
  }
}

// --- helpers ---

const ok = (room: Room): Result => ({ ok: true, room });
const fail = (error: DomainError): Result => ({ ok: false, error });

/** Every real state change goes through here, so version bumps exactly once per change. */
function commit(
  room: Room,
  changes: Partial<Pick<Room, "phase" | "participants">>,
): Room {
  return { ...room, ...changes, version: room.version + 1 };
}

function withParticipant(
  room: Room,
  participant: Participant,
): ReadonlyMap<ParticipantId, Participant> {
  return new Map(room.participants).set(participant.id, participant);
}

function without(room: Room, participantId: ParticipantId): Room {
  const participants = new Map(room.participants);
  participants.delete(participantId);
  return commit(room, { participants });
}

function hasAnyVote(room: Room): boolean {
  for (const participant of room.participants.values()) {
    if (participant.vote !== null) return true;
  }
  return false;
}

// --- commands ---

function join(room: Room, cmd: CommandOf<"join">): Result {
  // Normalised and validated by the rule the client shares (src/shared/rules).
  const name = validName(cmd.name);
  if (name === null) return fail("INVALID_NAME");

  const existing = room.participants.get(cmd.participantId);
  if (existing) {
    // Reclaiming a seat after refresh or reconnect: keep the vote, restore presence.
    if (existing.name === name && existing.status === "connected")
      return ok(room);
    const reclaimed: Participant = {
      ...existing,
      name,
      status: "connected",
      disconnectedAt: null,
    };
    return ok(commit(room, { participants: withParticipant(room, reclaimed) }));
  }

  if (room.participants.size >= MAX_PARTICIPANTS) return fail("ROOM_FULL");

  const joined: Participant = {
    id: cmd.participantId,
    name,
    vote: null,
    status: "connected",
    disconnectedAt: null,
  };
  return ok(commit(room, { participants: withParticipant(room, joined) }));
}

function castVote(room: Room, cmd: CommandOf<"castVote">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.status !== "connected") return fail("NOT_CONNECTED");
  // Principle: a command whose requested end state already holds is a no-op,
  // regardless of phase. Re-sending the card you already hold changes nothing, so
  // it succeeds silently even after reveal; a *different* card asks for a change
  // the phase forbids, so it's rejected. This lets a reconnecting client safely
  // retry its last unacknowledged vote instead of getting an error.
  if (participant.vote === cmd.card) return ok(room); // no-op: same card already cast
  if (room.phase === "revealed") return fail("VOTING_CLOSED");
  const voted: Participant = { ...participant, vote: cmd.card };
  return ok(commit(room, { participants: withParticipant(room, voted) }));
}

function clearVote(room: Room, cmd: CommandOf<"clearVote">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.status !== "connected") return fail("NOT_CONNECTED");
  if (participant.vote === null) return ok(room); // no-op: nothing to clear
  if (room.phase === "revealed") return fail("VOTING_CLOSED");
  const cleared: Participant = { ...participant, vote: null };
  return ok(commit(room, { participants: withParticipant(room, cleared) }));
}

function reveal(room: Room, cmd: CommandOf<"reveal">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.status !== "connected") return fail("NOT_CONNECTED");
  // No-op check precedes NO_VOTES_CAST: if everyone who voted has since left,
  // a second reveal must not suddenly start erroring.
  if (room.phase === "revealed") return ok(room);
  if (!hasAnyVote(room)) return fail("NO_VOTES_CAST");
  return ok(commit(room, { phase: "revealed" }));
}

function reset(room: Room, cmd: CommandOf<"reset">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.status !== "connected") return fail("NOT_CONNECTED");
  if (room.phase === "voting" && !hasAnyVote(room)) return ok(room); // no-op: already clean
  const participants = new Map(room.participants);
  for (const [id, p] of participants) {
    if (p.vote !== null) participants.set(id, { ...p, vote: null });
  }
  return ok(commit(room, { phase: "voting", participants }));
}

function disconnect(
  room: Room,
  cmd: CommandOf<"disconnect">,
  now: number,
): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return ok(room); // no-op: disconnect for someone already gone (e.g. after leave)
  if (participant.status === "disconnected") return ok(room); // no-op: already disconnected
  const gone: Participant = {
    ...participant,
    status: "disconnected",
    disconnectedAt: now,
  };
  return ok(commit(room, { participants: withParticipant(room, gone) }));
}

function leave(room: Room, cmd: CommandOf<"leave">): Result {
  if (!room.participants.has(cmd.participantId)) return ok(room); // no-op: already gone
  return ok(without(room, cmd.participantId));
}

/**
 * Removes a participant whose grace period is over. Unlike leave, it has a
 * rule, and the rule lives here: the sweep proposes, the domain decides. A
 * participant who reconnected a moment before the sweep ran is a no-op by
 * construction, whatever the sweep's timing.
 */
function expire(room: Room, cmd: CommandOf<"expire">, now: number): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return ok(room); // no-op: already gone
  if (participant.disconnectedAt === null) return ok(room); // no-op: connected
  if (now - participant.disconnectedAt < DISCONNECT_GRACE_MS) return ok(room); // no-op: still in grace
  return ok(without(room, cmd.participantId));
}
