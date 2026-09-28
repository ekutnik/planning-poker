import { createServer } from "node:net";

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
