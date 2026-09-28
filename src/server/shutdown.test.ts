import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, onTestFinished } from "vitest";
import WebSocket from "ws";
import { socketPath } from "../shared/protocol.js";
import { firstLine, freePort } from "./child.testing.js";

/**
 * Shutdown (#29), with the real server in a child process and real signals,
 * as a deploy would send them. A client that pauses its socket stands for a
 * closed laptop: it never answers the close handshake.
 */

const ROOM = "abcdefghijk";
// Vitest runs with NODE_ENV=test; the server here is in development mode.
const { NODE_ENV: _ignored, ...base } = process.env;

async function server(env: Record<string, string> = {}) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/main.ts"],
    { env: { ...base, PORT: String(port), LOG_LEVEL: "info", ...env } },
  );
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  const exited = once(child, "exit") as Promise<[number | null, string | null]>;
  // Fastify listens on ::1 and 127.0.0.1 and logs each: wait for the one
  // the client connects to, or it can be refused in between.
  await firstLine(child.stdout, "Server listening at http://127.0.0.1", 6_000);
  return { port, child, exited };
}

/** A client that has joined the room, and the close it receives. */
async function client(port: number) {
  const socket = new WebSocket(
    `ws://127.0.0.1:${String(port)}${socketPath(ROOM)}`,
  );
  await once(socket, "open");
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
  });
  socket.send(
    JSON.stringify({
      type: "join",
      sessionToken: "SESSIONTOKEN_SHUTDOWN_01",
      name: "Ada",
    }),
  );
  await once(socket, "message"); // the first snapshot: joined
  onTestFinished(() => {
    socket.terminate();
  });
  return { socket, closed };
}

const seconds = (since: number) => (performance.now() - since) / 1000;

describe("shutdown (#29)", () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "on %s, closes every socket with 1001 and exits with 0",
    async (signal) => {
      const { port, child, exited } = await server();
      const { closed } = await client(port);
      child.kill(signal);
      expect(await closed).toEqual({ code: 1001, reason: "going away" });
      const [code] = await exited;
      expect(code).toBe(0);
    },
  );

  it("drops a socket that never answers after the grace, and still exits with 0", async () => {
    const { port, child, exited } = await server();
    const { socket } = await client(port);
    socket.pause(); // a closed laptop: the close frame is never read
    const start = performance.now();
    child.kill("SIGTERM");
    const [code] = await exited;
    expect(code).toBe(0);
    expect(seconds(start)).toBeGreaterThan(1.5); // waited the 2s grace
  });

  it("exits at once, with 1, on a second signal", async () => {
    const { port, child, exited } = await server();
    const { socket } = await client(port);
    socket.pause();
    const start = performance.now();
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    child.kill("SIGTERM");
    const [code] = await exited;
    expect(code).toBe(1);
    expect(seconds(start)).toBeLessThan(1.5); // not the 2s grace
  });

  it("exits with 1 when the shutdown outlasts SHUTDOWN_TIMEOUT_MS", async () => {
    const { port, child, exited } = await server({
      SHUTDOWN_TIMEOUT_MS: "300",
    });
    const { socket } = await client(port);
    socket.pause();
    const start = performance.now();
    child.kill("SIGTERM");
    const [code] = await exited;
    expect(code).toBe(1);
    expect(seconds(start)).toBeLessThan(1.5);
  });
});
