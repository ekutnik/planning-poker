import { describe, expect, it } from "vitest";
import { createRoom, TooManyRooms } from "./api.js";

const respond = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("createRoom", () => {
  it("returns the new room id", async () => {
    await expect(
      createRoom(respond(200, { roomId: "abcdefghij_" })),
    ).resolves.toBe("abcdefghij_");
  });

  it("says how long to wait when the server's limit refuses it (ADR 0009)", async () => {
    const tooMany = (retryAfter?: string) => () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
          status: 429,
          headers:
            retryAfter === undefined ? {} : { "Retry-After": retryAfter },
        }),
      );
    await expect(createRoom(tooMany("90"))).rejects.toEqual(
      new TooManyRooms(90),
    );
    const refused = await createRoom(tooMany("90")).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(TooManyRooms);
    expect((refused as TooManyRooms).retryAfterSeconds).toBe(90);
    // No usable header: a minute.
    for (const header of [undefined, "soon", "0"]) {
      const error = await createRoom(tooMany(header)).catch((e: unknown) => e);
      expect((error as TooManyRooms).retryAfterSeconds).toBe(60);
    }
  });

  it("refuses a failed request or a malformed id", async () => {
    await expect(createRoom(respond(503, {}))).rejects.toThrow("503");
    await expect(createRoom(respond(200, { roomId: "../x" }))).rejects.toThrow(
      "no valid room id",
    );
  });
});
