/**
 * Application close codes. This is the only place their numbers live: server,
 * client and issues refer to them by name. RFC 6455 reserves 4000–4999 for
 * applications. The client branches on these; for example, it must not
 * auto-reconnect after SUPERSEDED or OUTDATED_CLIENT.
 *
 * Standard codes the protocol already defines (1000 normal, 1009 too big,
 * 1013 try again later) are not repeated here.
 */
export const CloseCode = {
  /** The same participant joined from another tab or device (ADR 0006). */
  SUPERSEDED: 4001,
  /** The client speaks a different protocol version than the server (#17). */
  OUTDATED_CLIENT: 4002,
  /** The socket did not send `join` in time (#14). */
  JOIN_TIMEOUT: 4003,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];
