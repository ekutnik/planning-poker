import { ROOM_ID_PATTERN } from "../shared/rules.js";

/**
 * The server's limit on room ids per address said no (ADR 0009): try again
 * after `retryAfterSeconds`, from its Retry-After header.
 */
export class TooManyRooms extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("POST /api/rooms: 429");
  }
}

/** Creates a room and returns its id, checked against the shared rule. */
export async function createRoom(
  post: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const response = await post("/api/rooms", { method: "POST" });
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    throw new TooManyRooms(
      Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
    );
  }
  if (!response.ok) throw new Error(`POST /api/rooms: ${response.status}`);
  const body = (await response.json()) as { roomId?: unknown };
  if (typeof body.roomId !== "string" || !ROOM_ID_PATTERN.test(body.roomId)) {
    throw new Error("POST /api/rooms: no valid room id in the response");
  }
  return body.roomId;
}
