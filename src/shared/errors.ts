/**
 * Errors the room domain can return as values (never thrown). Lives in `shared`
 * because the wire protocol's `ErrorCode` extends it — the client must be able to
 * name the same failure the server produced.
 */
export type DomainError =
  | "INVALID_NAME"
  | "ROOM_FULL"
  | "UNKNOWN_PARTICIPANT"
  | "NOT_CONNECTED"
  | "VOTING_CLOSED"
  | "NO_VOTES_CAST"
  | "TICKET_TOO_LONG"
  | "INVALID_DURATION";
