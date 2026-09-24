import { createHash, randomBytes } from "node:crypto";

/** Public participant id: one-way, room-salted, 96 bits. See ADR 0006. */
export function derivePublicId(roomId: string, sessionToken: string): string {
  return createHash("sha256")
    .update(`${roomId}:${sessionToken}`)
    .digest("base64url")
    .slice(0, 16);
}

/** 64 random bits, which base64url-encodes to 11 characters. */
export function generateRoomId(): string {
  return randomBytes(8).toString("base64url");
}

export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Log-safe stand-in for a room id. With no authentication (ADR 0005) a room id
 * is a join link, so it stays out of logs like a token. 32 bits of hash are
 * enough to correlate lines about one room, not to recover a 64-bit id.
 */
export function roomLogId(roomId: string): string {
  return createHash("sha256").update(roomId).digest("hex").slice(0, 8);
}
