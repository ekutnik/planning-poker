import { createServer } from "node:net";
import { CONFIG_VARIABLES } from "./config.js";

/**
 * Helpers for tests that start the real server in a child process (the
 * config and shutdown tests). Not a test file itself: it only exports.
 */

const PORTS_PER_WORKER = 100;
let nextPort = 0;

/**
 * A port nothing is listening on, for a child server to listen on.
 *
 * Not one the OS picks (listening on 0): those come from the ephemeral
 * range (49152 and up on macOS, 32768 and up on Linux), which outgoing
 * connections draw from as well. Between this returning and the child listening, about 200 ms, a
 * connection from a test in another worker could take the port, and the
 * child would exit with EADDRINUSE (it happened once, in a pre-push check).
 * So each worker counts through its own ports, below that range, and skips
 * any that something else is using.
 */
export async function freePort(): Promise<number> {
  const first = firstPort();
  for (let tried = 0; tried < PORTS_PER_WORKER; tried += 1) {
    const port = first + (nextPort++ % PORTS_PER_WORKER);
    if (await listenable(port)) return port;
  }
  throw new Error(
    `no free port from ${String(first)} to ${String(first + PORTS_PER_WORKER - 1)}`,
  );
}

/**
 * The first of this worker's ports, all below 32768, where both ephemeral
 * ranges start at the earliest (free-port.test.ts checks it on each OS).
 * Vitest numbers its workers from 1 and Playwright (the e2e suite) from 0;
 * each runner has its own range, so the two running at once can't collide
 * either.
 */
function firstPort(): number {
  const vitest = process.env.VITEST_POOL_ID;
  if (vitest !== undefined) return 20_000 + Number(vitest) * PORTS_PER_WORKER;
  const playwright = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  return 30_000 + playwright * PORTS_PER_WORKER;
}

/** Whether a server can listen on `port` right now. */
function listenable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * The first line of `stream` containing `containing`, within `timeoutMs`.
 * If the stream ends first (the child exited), the error carries what it
 * printed, so the reason shows in the failure.
 */
export function firstLine(
  stream: NodeJS.ReadableStream,
  containing: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`no line containing ${containing} in ${timeoutMs}ms`)),
      timeoutMs,
    );
    let buffered = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffered += chunk;
      const line = buffered.split("\n").find((l) => l.includes(containing));
      if (line) {
        clearTimeout(timer);
        resolve(line);
      }
    });
    stream.on("end", () => {
      clearTimeout(timer);
      reject(
        new Error(
          `no line containing ${containing}; the output ended with:\n${buffered.slice(-2_000)}`,
        ),
      );
    });
  });
}

/**
 * The environment for a child server: this process's, without any variable
 * the server reads, then the test's own. A NODE_ENV or MAX_ROOMS set in
 * someone's shell (or Vitest's NODE_ENV=test) never reaches the server.
 */
export function serverEnv(
  env: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = { ...process.env };
  for (const name of CONFIG_VARIABLES) delete inherited[name];
  return { ...inherited, ...env };
}
