import type { Card } from "../../shared/deck.js";

export const MAX_PARTICIPANTS = 30;
export const MAX_NAME_LENGTH = 32;

export type ParticipantId = string;
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
  | { readonly type: "leave"; readonly participantId: ParticipantId };

export type DomainError =
  | "INVALID_NAME"
  | "ROOM_FULL"
  | "UNKNOWN_PARTICIPANT"
  | "VOTING_CLOSED"
  | "NO_VOTES_CAST";

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

function hasAnyVote(room: Room): boolean {
  for (const participant of room.participants.values()) {
    if (participant.vote !== null) return true;
  }
  return false;
}

// --- commands ---

function join(room: Room, cmd: CommandOf<"join">): Result {
  const name = cmd.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH)
    return fail("INVALID_NAME");

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
  if (participant.vote === cmd.card) return ok(room); // no-op: same card already cast
  if (room.phase === "revealed") return fail("VOTING_CLOSED");
  const voted: Participant = { ...participant, vote: cmd.card };
  return ok(commit(room, { participants: withParticipant(room, voted) }));
}

function clearVote(room: Room, cmd: CommandOf<"clearVote">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.vote === null) return ok(room); // no-op: nothing to clear
  if (room.phase === "revealed") return fail("VOTING_CLOSED");
  const cleared: Participant = { ...participant, vote: null };
  return ok(commit(room, { participants: withParticipant(room, cleared) }));
}

function reveal(room: Room, cmd: CommandOf<"reveal">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  // No-op check precedes NO_VOTES_CAST: if everyone who voted has since left,
  // a second reveal must not suddenly start erroring.
  if (room.phase === "revealed") return ok(room);
  if (!hasAnyVote(room)) return fail("NO_VOTES_CAST");
  return ok(commit(room, { phase: "revealed" }));
}

function reset(room: Room, cmd: CommandOf<"reset">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
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
  const participants = new Map(room.participants);
  participants.delete(cmd.participantId);
  return ok(commit(room, { participants }));
}
