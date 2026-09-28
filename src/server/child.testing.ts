import { createServer } from "node:net";
import { CONFIG_VARIABLES } from "./config.js";

/**
 * Helpers for tests that start the real server in a child process (the
 * config and shutdown tests). Not a test file itself: it only exports.
 */

/** A port nothing is listening on, found by asking the OS for one. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** The first line of `stream` containing `containing`, within `timeoutMs`. */
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
    stream.on("end", () =>
      reject(new Error(`no line containing ${containing}`)),
    );
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
