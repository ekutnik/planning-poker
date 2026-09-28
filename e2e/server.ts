import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { firstLine, freePort } from "../src/server/child.testing.js";

const MAIN = fileURLToPath(new URL("../dist/server/main.js", import.meta.url));

/**
 * A server of the test's own, for what the shared one can't do: stop and
 * start again. The same compiled server in production mode, on a free port;
 * the suite's webServer has already built it.
 */
export class OwnServer {
  private child: ChildProcess | null = null;
  /** Everything the server has logged, across restarts. */
  output = "";

  private constructor(readonly port: number) {}

  static async start(): Promise<OwnServer> {
    const server = new OwnServer(await freePort());
    await server.restart();
    return server;
  }

  get url(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  /** Starts it, on the same port as before. */
  async restart(): Promise<void> {
    const child = spawn(process.execPath, [MAIN], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(this.port),
        LOG_LEVEL: "info",
      },
    });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.output += chunk.toString();
    });
    await firstLine(child.stdout, "Server listening", 10_000);
  }

  /** Sends SIGTERM, as a deploy does, and resolves with the exit code. */
  async stop(): Promise<number | null> {
    const child = this.child;
    if (child === null || child.exitCode !== null)
      return child?.exitCode ?? null;
    const exited = once(child, "exit") as Promise<[number | null]>;
    child.kill("SIGTERM");
    const [code] = await exited;
    this.child = null;
    return code;
  }

  kill(): void {
    this.child?.kill("SIGKILL");
    this.child = null;
  }
}
