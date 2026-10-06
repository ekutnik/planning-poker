import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import type { Proxy } from "./client-ip.js";

/**
 * The client's address as the request log records it, through the real
 * server: Fly-Client-IP only behind Fly's proxy, the socket otherwise.
 */

let app: ReturnType<typeof buildServer> | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

/** The remoteAddress logged for one request with these headers. */
async function loggedAddress(
  proxy: Proxy | undefined,
  headers: Record<string, string>,
): Promise<string | undefined> {
  const lines: { req?: { remoteAddress?: string } }[] = [];
  app = buildServer({
    proxy,
    logger: {
      stream: {
        write: (line: string) =>
          lines.push(JSON.parse(line) as { req?: { remoteAddress?: string } }),
      },
    },
  });
  const response = await app.inject({
    method: "GET",
    // Any route but /health, which writes no request line (#65).
    url: "/nowhere",
    headers,
    remoteAddress: "10.0.0.9", // the connection: Fly's proxy, on Fly
  });
  expect(response.statusCode).toBe(404);
  return lines.find((line) => line.req !== undefined)?.req?.remoteAddress;
}

describe("the client's address (PROXY)", () => {
  it("behind Fly, is the address Fly's proxy puts in Fly-Client-IP", async () => {
    expect(await loggedAddress("fly", { "fly-client-ip": "203.0.113.7" })).toBe(
      "203.0.113.7",
    );
  });

  it("behind Fly, falls back to the connection without the header", async () => {
    expect(await loggedAddress("fly", {})).toBe("10.0.0.9");
  });

  it("with no proxy, ignores the header: a client could send it and choose its own address", async () => {
    expect(
      await loggedAddress(undefined, { "fly-client-ip": "203.0.113.7" }),
    ).toBe("10.0.0.9");
  });

  it("never reads X-Forwarded-For, whose entries Fly doesn't vouch for", async () => {
    expect(
      await loggedAddress("fly", { "x-forwarded-for": "198.51.100.1" }),
    ).toBe("10.0.0.9");
  });
});
