import { spawn } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import WebSocket from "ws";
import { socketPath } from "../shared/protocol.js";
import { firstLine, freePort, serverEnv } from "./child.testing.js";
import { onShutdownSignal } from "./shutdown.js";

/**
 * Shutdown (#29). onShutdownSignal's decisions are tested first, with fakes
 * for the process: which exit code, when, and what it logs. Then the real
 * server in a child process, with real signals as a deploy would send them,
 * for what only a real process can show: the 1001s, the grace, and the exit
 * codes. A client that pauses its socket stands for a closed laptop: it
 * never answers the close handshake.
 */

function setup(close: () => Promise<void> = () => Promise.resolve()) {
  const exits: number[] = [];
  const timers: { ms: number; callback: () => void }[] = [];
  const logs: { level: string; args: unknown[] }[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      logs.push({ level, args });
    };
  let closes = 0;
  const onSignal = onShutdownSignal({
    close: () => {
      closes += 1;
      return close();
    },
    exit: (code) => {
      exits.push(code);
    },
    after: (ms, callback) => {
      timers.push({ ms, callback });
    },
    log: { info: record("info"), warn: record("warn"), error: record("error") },
    timeoutMs: 10_000,
  });
  return { onSignal, exits, timers, logs, closes: () => closes };
}

/** Lets a settled close() run its callback. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** A close() that never finishes: a shutdown that hangs. */
const never = () => new Promise<void>(() => undefined);

describe("onShutdownSignal (#29)", () => {
  it("closes the server and exits with 0, with the timeout set", async () => {
    const { onSignal, exits, timers, logs, closes } = setup();
    onSignal("SIGTERM");
    expect(closes()).toBe(1);
    expect(timers.map((timer) => timer.ms)).toEqual([10_000]);
    await settle();
    expect(exits).toEqual([0]);
    expect(logs).toEqual([
      { level: "info", args: [{ signal: "SIGTERM" }, "shutting down"] },
      { level: "info", args: ["shut down"] },
    ]);
  });

  it("exits at once with 1 on a second signal, without closing again", () => {
    const { onSignal, exits, logs, closes } = setup(never);
    onSignal("SIGTERM");
    onSignal("SIGINT");
    expect(exits).toEqual([1]);
    expect(closes()).toBe(1);
    expect(logs.at(-1)).toEqual({
      level: "warn",
      args: [{ signal: "SIGINT" }, "second signal: exiting now"],
    });
  });

  it("exits with 1 when the shutdown outlasts the timeout", async () => {
    const { onSignal, exits, timers, logs } = setup(never);
    onSignal("SIGTERM");
    await settle();
    expect(exits).toEqual([]);
    timers[0]?.callback();
    expect(exits).toEqual([1]);
    expect(logs.at(-1)).toEqual({
      level: "error",
      args: [{ timeoutMs: 10_000 }, "shutdown took too long: exiting now"],
    });
  });

  it("exits with 1, and logs the error, when closing fails", async () => {
    const failure = new Error("close failed");
    const { onSignal, exits, logs } = setup(() => Promise.reject(failure));
    onSignal("SIGTERM");
    await settle();
    expect(exits).toEqual([1]);
    expect(logs.at(-1)).toEqual({
      level: "error",
      args: [failure, "shutdown failed"],
    });
  });
});

const ROOM = "abcdefghijk";

async function server(env: Record<string, string> = {}) {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server/main.ts"],
    {
      env: serverEnv({
        PORT: String(port),
        HOST: "127.0.0.1",
        LOG_LEVEL: "info",
        ...env,
      }),
    },
  );
  onTestFinished(() => {
    child.kill("SIGKILL");
  });
  const exited = once(child, "exit") as Promise<[number | null, string | null]>;
  await firstLine(child.stdout, "Server listening", 6_000);
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

describe("shutdown in the real process (#29)", () => {
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

  it("closes a connection that arrives during the grace, so it can't hold up the exit", async () => {
    const { port, child, exited } = await server();
    const { socket } = await client(port);
    socket.pause(); // a closed laptop keeps the grace running
    const start = performance.now();
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
    // A browser reconnecting after its 1001, which leaves its side open
    // after the answer, as a browser may.
    const late = connect(
      { port, host: "127.0.0.1", allowHalfOpen: true },
      () => {
        late.write(
          [
            `GET ${socketPath(ROOM)} HTTP/1.1`,
            "Host: 127.0.0.1",
            "Connection: Upgrade",
            "Upgrade: websocket",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
            "",
            "",
          ].join("\r\n"),
        );
      },
    );
    onTestFinished(() => {
      late.destroy();
    });
    const [answer] = (await once(late, "data")) as [Buffer];
    expect(answer.toString()).toMatch(/^HTTP\/1\.1 503 /);
    await once(late, "end"); // the server closed its side
    const [code] = await exited;
    expect(code).toBe(0);
    expect(seconds(start)).toBeLessThan(4); // the grace, not the 10s timeout
  });

  it("closes a connection that never sent a request, so it can't hold up the exit", async () => {
    const { port, child, exited } = await server();
    await client(port);
    // A browser's preconnect: a spare connection, opened ahead of need,
    // on which no request has been sent. The HTTP server counts it neither
    // as a request nor as idle, so close() would wait for it.
    const spare = connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    await once(spare, "connect");
    onTestFinished(() => {
      spare.destroy();
    });
    const start = performance.now();
    child.kill("SIGTERM");
    const [code] = await exited;
    expect(code).toBe(0);
    expect(seconds(start)).toBeLessThan(1.5); // no grace needed, no timeout
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
});
