import type { Card } from "../../shared/deck.js";
import type { ParticipantId } from "../../shared/ids.js";
import type { DomainError } from "../../shared/errors.js";
import type { TimerView } from "../../shared/snapshot.js";

import {
  cleanTicket,
  MAX_PARTICIPANTS,
  MAX_TICKET_LENGTH,
  TIMER_ADD_MS,
  TIMER_DEFAULT_MS,
  TIMER_MAX_MS,
  validDuration,
  validName,
} from "../../shared/rules.js";
import { computeResults } from "./results.js";

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
  /**
   * The ticket being estimated, cleaned (shared/rules.ts), or null. It stays
   * across rounds until someone edits it, and goes with the room.
   */
  readonly ticket: string | null;
  /** Keep score: off until someone turns it on. */
  readonly scoring: boolean;
  /**
   * Points per participant, awarded at each reveal while scoring is on and
   * never recalculated. Turning scoring off keeps them; leaving loses them.
   * Someone with no entry has 0.
   */
  readonly scores: ReadonlyMap<ParticipantId, number>;
  /**
   * The timer (ADR 0008): idle until someone starts it, back to idle at every
   * reveal and at Start next round. Its duration stays across rounds.
   */
  readonly timer: TimerView;
  /** "timer" once the timer has revealed the round; null otherwise. */
  readonly revealCause: "timer" | null;
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
  | {
      readonly type: "setTicket";
      readonly participantId: ParticipantId;
      readonly text: string;
    }
  | {
      readonly type: "setScoring";
      readonly participantId: ParticipantId;
      readonly on: boolean;
    }
  | {
      readonly type: "timerSetDuration";
      readonly participantId: ParticipantId;
      readonly ms: number;
    }
  | { readonly type: "timerStart"; readonly participantId: ParticipantId }
  | { readonly type: "timerPause"; readonly participantId: ParticipantId }
  | { readonly type: "timerResume"; readonly participantId: ParticipantId }
  | { readonly type: "timerAdd"; readonly participantId: ParticipantId }
  /**
   * The server's own command, when a running timer's deadline has passed: it
   * comes from the room service's timer, never from a client.
   */
  | { readonly type: "timeUp" }
  | { readonly type: "expire"; readonly participantId: ParticipantId };

export type { DomainError };

export type Result =
  | { readonly ok: true; readonly room: Room }
  | { readonly ok: false; readonly error: DomainError };

type CommandOf<T extends Command["type"]> = Extract<Command, { type: T }>;

export function createRoom(id: string): Room {
  return {
    id,
    phase: "voting",
    participants: new Map(),
    version: 0,
    ticket: null,
    scoring: false,
    scores: new Map(),
    timer: idleTimer(TIMER_DEFAULT_MS),
    revealCause: null,
  };
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
    case "setTicket":
      return setTicket(room, command);
    case "setScoring":
      return setScoring(room, command);
    case "timerSetDuration":
      return timerSetDuration(room, command);
    case "timerStart":
      return timerStart(room, command, now);
    case "timerPause":
      return timerPause(room, command, now);
    case "timerResume":
      return timerResume(room, command, now);
    case "timerAdd":
      return timerAdd(room, command, now);
    case "timeUp":
      return timeUp(room, now);
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
  changes: Partial<
    Pick<
      Room,
      | "phase"
      | "participants"
      | "ticket"
      | "scoring"
      | "scores"
      | "timer"
      | "revealCause"
    >
  >,
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
  // Someone removed from the room loses their points; a newcomer with the
  // same name starts at 0. A reconnect keeps its id, and so its points.
  if (!room.scores.has(participantId)) return commit(room, { participants });
  const scores = new Map(room.scores);
  scores.delete(participantId);
  return commit(room, { participants, scores });
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
  return ok(revealRound(room));
}

/**
 * The one way a round is revealed, by a person or by the timer, so both
 * score the same and both stop the timer. One commit: the version goes up
 * once. Fields that are already as they should be are left alone, so with
 * nothing new switched on a reveal is exactly the reveal it always was.
 */
function revealRound(room: Room, cause: "timer" | null = null): Room {
  return commit(room, {
    phase: "revealed",
    ...pointsAtReveal(room),
    ...stopTimer(room),
    ...(cause === room.revealCause ? {} : { revealCause: cause }),
  });
}

function idleTimer(durationMs: number): TimerView {
  return { durationMs, state: "idle", endsAt: null, remainingMs: null };
}

/** The timer back to idle, keeping its duration; nothing if it already is. */
function stopTimer(room: Room): Partial<Pick<Room, "timer">> {
  return room.timer.state === "idle"
    ? {}
    : { timer: idleTimer(room.timer.durationMs) };
}

/**
 * Keeping score, a separate step of the reveal, in the same commit so the
 * version still goes up once. It adds nothing while scoring is off, so the
 * reveal is then exactly what it was. With exactly one winning card, by the
 * same rule the result shows (computeResults, not a copy of it), everyone
 * who voted it gets a point; a draw, no result or no votes gives none.
 * Every reveal counts, including a second round on the same ticket.
 */
function pointsAtReveal(room: Room): Partial<Pick<Room, "scores">> {
  if (!room.scoring) return {};
  const [winner, ...others] = computeResults(room).winners;
  if (winner === undefined || others.length > 0) return {};
  const scores = new Map(room.scores);
  for (const participant of room.participants.values()) {
    if (participant.vote === winner) {
      scores.set(participant.id, (scores.get(participant.id) ?? 0) + 1);
    }
  }
  return { scores };
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
  return ok(
    commit(room, {
      phase: "voting",
      participants,
      ...stopTimer(room),
      ...(room.revealCause === null ? {} : { revealCause: null }),
    }),
  );
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
 * Sets the ticket being estimated, for everyone, in either phase: a view of
 * the room, like facilitation, so anyone in it may (ADR 0005). Cleaned first;
 * empty clears it; the same text again is a no-op.
 */
function setTicket(room: Room, cmd: CommandOf<"setTicket">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.status !== "connected") return fail("NOT_CONNECTED");
  const ticket = cleanTicket(cmd.text);
  if (ticket !== null && ticket.length > MAX_TICKET_LENGTH) {
    return fail("TICKET_TOO_LONG");
  }
  if (ticket === room.ticket) return ok(room); // no-op: already the ticket
  return ok(commit(room, { ticket }));
}

/**
 * Keep score, on or off, for the whole room; anyone in it may (ADR 0005).
 * Off hides the scores and keeps them; on again shows them as they were.
 */
function setScoring(room: Room, cmd: CommandOf<"setScoring">): Result {
  const participant = room.participants.get(cmd.participantId);
  if (!participant) return fail("UNKNOWN_PARTICIPANT");
  if (participant.status !== "connected") return fail("NOT_CONNECTED");
  if (room.scoring === cmd.on) return ok(room); // no-op: already so
  return ok(commit(room, { scoring: cmd.on }));
}

// --- the timer (ADR 0008) ---
//
// Every command but timeUp checks who sent it first, as every command does.
// A timer command whose end state already holds is a no-op, and so is one
// that no longer applies (Pause after the timer ended, +30 s while idle):
// those race with the deadline itself, so they must not turn into errors.

/** The sender's checks, shared by the timer's commands. */
function sender(room: Room, participantId: ParticipantId): DomainError | null {
  const participant = room.participants.get(participantId);
  if (!participant) return "UNKNOWN_PARTICIPANT";
  if (participant.status !== "connected") return "NOT_CONNECTED";
  return null;
}

/** Any time: the length used from the next start. A running timer keeps its deadline. */
function timerSetDuration(
  room: Room,
  cmd: CommandOf<"timerSetDuration">,
): Result {
  const refused = sender(room, cmd.participantId);
  if (refused) return fail(refused);
  if (!validDuration(cmd.ms)) return fail("INVALID_DURATION");
  if (room.timer.durationMs === cmd.ms) return ok(room); // no-op
  return ok(commit(room, { timer: { ...room.timer, durationMs: cmd.ms } }));
}

/** While voting and idle: the deadline is now plus the duration. */
function timerStart(
  room: Room,
  cmd: CommandOf<"timerStart">,
  now: number,
): Result {
  const refused = sender(room, cmd.participantId);
  if (refused) return fail(refused);
  if (room.timer.state !== "idle") return ok(room); // no-op: already started
  if (room.phase === "revealed") return fail("VOTING_CLOSED");
  return ok(
    commit(room, {
      timer: {
        durationMs: room.timer.durationMs,
        state: "running",
        endsAt: now + room.timer.durationMs,
        remainingMs: null,
      },
    }),
  );
}

/** While running: keep what is left. */
function timerPause(
  room: Room,
  cmd: CommandOf<"timerPause">,
  now: number,
): Result {
  const refused = sender(room, cmd.participantId);
  if (refused) return fail(refused);
  const { state, endsAt, durationMs } = room.timer;
  if (state !== "running" || endsAt === null) return ok(room); // no-op
  return ok(
    commit(room, {
      timer: {
        durationMs,
        state: "paused",
        endsAt: null,
        remainingMs: Math.max(0, endsAt - now),
      },
    }),
  );
}

/** While paused: a new deadline, from what was left. */
function timerResume(
  room: Room,
  cmd: CommandOf<"timerResume">,
  now: number,
): Result {
  const refused = sender(room, cmd.participantId);
  if (refused) return fail(refused);
  const { state, remainingMs, durationMs } = room.timer;
  if (state !== "paused" || remainingMs === null) return ok(room); // no-op
  return ok(
    commit(room, {
      timer: {
        durationMs,
        state: "running",
        endsAt: now + remainingMs,
        remainingMs: null,
      },
    }),
  );
}

/** Running or paused: 30 s more, never past TIMER_MAX_MS left. */
function timerAdd(room: Room, cmd: CommandOf<"timerAdd">, now: number): Result {
  const refused = sender(room, cmd.participantId);
  if (refused) return fail(refused);
  const { state, endsAt, remainingMs } = room.timer;
  if (state === "running" && endsAt !== null) {
    const next = Math.min(endsAt + TIMER_ADD_MS, now + TIMER_MAX_MS);
    if (next <= endsAt) return ok(room); // no-op: already at the most
    return ok(commit(room, { timer: { ...room.timer, endsAt: next } }));
  }
  if (state === "paused" && remainingMs !== null) {
    const next = Math.min(remainingMs + TIMER_ADD_MS, TIMER_MAX_MS);
    if (next <= remainingMs) return ok(room); // no-op: already at the most
    return ok(commit(room, { timer: { ...room.timer, remainingMs: next } }));
  }
  return ok(room); // no-op: nothing to add to
}

/**
 * The deadline has passed: reveal, whether or not everyone has voted, by the
 * same revealRound as a person, and record that the timer did it. Checked
 * again here, whatever the caller believes: only a running timer whose
 * deadline is past can reveal. With no votes at all there is nothing to
 * reveal, so the timer only goes back to idle.
 */
function timeUp(room: Room, now: number): Result {
  const { state, endsAt } = room.timer;
  if (state !== "running" || endsAt === null) return ok(room); // no-op
  if (now < endsAt) return ok(room); // no-op: not yet
  if (!hasAnyVote(room)) return ok(commit(room, stopTimer(room)));
  return ok(revealRound(room, "timer"));
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
