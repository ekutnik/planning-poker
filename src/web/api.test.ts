import { describe, expect, it } from "vitest";
import { createRoom } from "./api.js";

const respond = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("createRoom", () => {
  it("returns the new room id", async () => {
    await expect(
      createRoom(respond(200, { roomId: "abcdefghij_" })),
    ).resolves.toBe("abcdefghij_");
  });

  it("refuses a failed request or a malformed id", async () => {
    await expect(createRoom(respond(503, {}))).rejects.toThrow("503");
    await expect(createRoom(respond(200, { roomId: "../x" }))).rejects.toThrow(
      "no valid room id",
    );
  });
});
