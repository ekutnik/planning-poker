import * as z from "zod";
import { DECK } from "./deck.js";
import type { DomainError } from "./errors.js";
import { SESSION_TOKEN_PATTERN } from "./rules.js";
import type { RoomSnapshot } from "./snapshot.js";

/**
 * The wire protocol. Inbound (client → server) is validated with Zod because it
 * crosses a trust boundary; outbound (server → client) is TypeScript types only,
 * because it is our own code deployed together. Validate where trust changes.
 */

const SessionToken = z.string().regex(SESSION_TOKEN_PATTERN);

/**
 * The wire protocol's version (#17). The client sends it in the socket URL;
 * the server closes any other value with CloseCode.OUTDATED_CLIENT, so a tab
 * left open across a deploy is told to reload instead of failing validation.
 * Bump it for any change an old client could not handle: a message renamed,
 * removed or given a new required field, or a field whose meaning changes.
 * A new server message type needs no bump, because clients ignore unknown
 * types (#20). The rule applies from the first deploy: until then no old
 * client exists anywhere.
 */
export const PROTOCOL_VERSION = 1;

/** The socket path for a room, carrying the protocol version. */
export function socketPath(roomId: string): string {
  return `/ws/${roomId}?v=${PROTOCOL_VERSION}`;
}

export const ClientMessage = z.discriminatedUnion("type", [
  // Only `join` carries identity (the session token). After join the socket *is*
  // the identity, so no other message has an actor field to forge. `roomId` is
  // never in a message — it comes from the socket URL (one room per connection).
  z.strictObject({
    type: z.literal("join"),
    sessionToken: SessionToken,
    // max(200) is a payload-sanity cap, a different concern from the domain's
    // 32-char *validity* rule applied after normalisation. Don't merge a business
    // rule into the wire format.
    name: z.string().max(200),
  }),
  z.strictObject({ type: z.literal("castVote"), card: z.enum(DECK) }),
  z.strictObject({ type: z.literal("clearVote") }),
  z.strictObject({ type: z.literal("reveal") }),
  z.strictObject({ type: z.literal("reset") }),
  z.strictObject({ type: z.literal("leave") }),
  // App-level liveness (#20). Browser JavaScript cannot see protocol pings,
  // so the client sends this about every 20s and reconnects if no reply
  // comes. It carries no state, so it is answered in any connection state.
  z.strictObject({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ErrorCode =
  | DomainError
  | "INVALID_MESSAGE"
  | "NOT_JOINED"
  | "ALREADY_JOINED"
  | "SERVER_FULL"
  | "RATE_LIMITED";

export type ServerMessage =
  | { readonly type: "snapshot"; readonly snapshot: RoomSnapshot }
  | { readonly type: "error"; readonly code: ErrorCode }
  /** The answer to a client `ping`. Any message proves the server is alive. */
  | { readonly type: "pong" };

/**
 * Parse and validate a raw inbound frame. Never throws: malformed JSON or any
 * schema violation returns null, so the transport can answer INVALID_MESSAGE.
 * `strictObject` rejects unknown keys rather than stripping them — at a trust
 * boundary, unexpected input is a signal worth rejecting.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessage.safeParse(json);
  return result.success ? result.data : null;
}
