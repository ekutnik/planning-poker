import type { FastifyBaseLogger } from "fastify";

/**
 * At shutdown, how long sockets get to finish their close handshake before
 * they are dropped (#29). A browser answers at once; a closed laptop never
 * does, and ws would otherwise wait 30 seconds for it.
 */
export const CLOSE_GRACE_MS = 2_000;

/** What a shutdown needs from the process, passed in so a test can fake it. */
export interface ShutdownDeps {
  /** Closes the server gracefully: app.close(). */
  readonly close: () => Promise<void>;
  /** Ends the process: process.exit(). */
  readonly exit: (code: number) => void;
  /** Runs `callback` once after `ms`, without keeping the process alive. */
  readonly after: (ms: number, callback: () => void) => void;
  readonly log: Pick<FastifyBaseLogger, "info" | "warn" | "error">;
  /** SHUTDOWN_TIMEOUT_MS: the backstop for a shutdown that never finishes. */
  readonly timeoutMs: number;
}

/**
 * The signal handler (#29). A deploy sends SIGTERM, Ctrl-C in npm run dev
 * sends SIGINT, and both mean the same: close gracefully, so every socket
 * gets 1001 and the client says the server is restarting, then exit with 0.
 * A second signal, or a shutdown still going after `timeoutMs`, exits at
 * once with 1; so does a close that fails.
 */
export function onShutdownSignal(
  deps: ShutdownDeps,
): (signal: NodeJS.Signals) => void {
  const { close, exit, after, log, timeoutMs } = deps;
  let stopping = false;
  return (signal) => {
    if (stopping) {
      log.warn({ signal }, "second signal: exiting now");
      exit(1);
      return;
    }
    stopping = true;
    log.info({ signal }, "shutting down");
    after(timeoutMs, () => {
      log.error({ timeoutMs }, "shutdown took too long: exiting now");
      exit(1);
    });
    close().then(
      () => {
        log.info("shut down");
        exit(0);
      },
      (error: unknown) => {
        log.error(error, "shutdown failed");
        exit(1);
      },
    );
  };
}
