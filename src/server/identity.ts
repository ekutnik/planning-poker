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
