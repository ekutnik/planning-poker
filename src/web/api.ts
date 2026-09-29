import { ROOM_ID_PATTERN } from "../shared/rules.js";

/** Creates a room and returns its id, checked against the shared rule. */
export async function createRoom(
  post: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const response = await post("/api/rooms", { method: "POST" });
  if (!response.ok) throw new Error(`POST /api/rooms: ${response.status}`);
  const body = (await response.json()) as { roomId?: unknown };
  if (typeof body.roomId !== "string" || !ROOM_ID_PATTERN.test(body.roomId)) {
    throw new Error("POST /api/rooms: no valid room id in the response");
  }
  return body.roomId;
}
