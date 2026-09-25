/*
 * The socket's address and protocol version, with no dependencies. It is
 * split from protocol.ts, which builds Zod schemas as soon as it loads: the
 * client imports this at runtime and never validates server messages, so it
 * must not pull Zod into the browser bundle.
 */

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
