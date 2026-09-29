import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { freePort, firstLine, serverEnv } from "./child.testing.js";
import {
  MIN_SHUTDOWN_TIMEOUT_MS,
  parseConfig,
  SHUTDOWN_TIMEOUT_MS,
} from "./config.js";
import {
  DEFAULT_LIMITS,
  MAX_SWEEP_INTERVAL_MS,
  ROOM_TTL_MS,
  SWEEP_INTERVAL_MS,
} from "./room-service.js";
import { CLOSE_GRACE_MS } from "./shutdown.js";

describe("parseConfig (#18)", () => {
  it("uses the defaults when nothing is set, and ignores unrelated variables", () => {
    expect(parseConfig({ HOME: "/home/someone", PATH: "/usr/bin" })).toEqual({
      ok: true,
      config: {
        port: 3000,
        host: "127.0.0.1",
        logLevel: "info",
        limits: DEFAULT_LIMITS,
        sweepIntervalMs: SWEEP_INTERVAL_MS,
        roomTtlMs: ROOM_TTL_MS,
        shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
        production: false,
        webRoot: undefined,
        proxy: undefined,
      },
    });
  });

  it("reads every setting", () => {
    expect(
      parseConfig({
        PORT: "8080",
        HOST: "0.0.0.0",
        LOG_LEVEL: "warn",
        MAX_ROOMS: "50",
        MAX_PENDING: "20",
        SWEEP_INTERVAL_MS: "1000",
        ROOM_TTL_MS: "60000",
        SHUTDOWN_TIMEOUT_MS: "5000",
        NODE_ENV: "production",
        WEB_ROOT: "/srv/web",
        PROXY: "fly",
      }),
    ).toEqual({
      ok: true,
      config: {
        port: 8080,
        host: "0.0.0.0",
        logLevel: "warn",
        limits: { maxRooms: 50, maxPending: 20 },
        sweepIntervalMs: 1000,
        roomTtlMs: 60_000,
        shutdownTimeoutMs: 5000,
        production: true,
        webRoot: "/srv/web",
        proxy: "fly",
      },
    });
  });

  it.each([
    ["MAX_ROOMS", "abc"],
    ["MAX_ROOMS", "0"],
    ["MAX_ROOMS", "1.5"],
    ["MAX_PENDING", "-3"],
    ["PORT", "70000"],
    ["PORT", ""],
    ["LOG_LEVEL", "loud"],
    ["SWEEP_INTERVAL_MS", "60000"],
    ["SWEEP_INTERVAL_MS", "10"],
    ["ROOM_TTL_MS", "ten minutes"],
    // An IP address only: "localhost" can mean ::1 or 127.0.0.1, or both.
    ["HOST", "localhost"],
    ["HOST", ""],
    ["HOST", " 0.0.0.0"],
    ["HOST", "999.0.0.1"],
    // Only a proxy the server knows how to read.
    ["PROXY", "nginx"],
    ["PROXY", ""],
    // Number() would accept all of these; plain decimal digits only.
    ["MAX_ROOMS", "0x10"],
    ["MAX_ROOMS", "1e4"],
    ["MAX_ROOMS", " 5"],
    ["MAX_ROOMS", "5 "],
    ["MAX_ROOMS", "+5"],
  ])("refuses %s=%j and names it", (name, value) => {
    const result = parseConfig({ [name]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(name);
  });

  it("caps SWEEP_INTERVAL_MS at MAX_SWEEP_INTERVAL_MS, the heartbeat's safe maximum", () => {
    const at = parseConfig({
      SWEEP_INTERVAL_MS: String(MAX_SWEEP_INTERVAL_MS),
    });
    const above = parseConfig({
      SWEEP_INTERVAL_MS: String(MAX_SWEEP_INTERVAL_MS + 1),
    });
    expect(at.ok).toBe(true);
    expect(above.ok).toBe(false);
  });

  it("keeps SHUTDOWN_TIMEOUT_MS longer than the close grace, so one closed laptop never fails a shutdown", () => {
    expect(MIN_SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(CLOSE_GRACE_MS);
    // A default is not validated by the schema: check it here.
    expect(SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_SHUTDOWN_TIMEOUT_MS);
    const at = parseConfig({
      SHUTDOWN_TIMEOUT_MS: String(MIN_SHUTDOWN_TIMEOUT_MS),
    });
    const below = parseConfig({
      SHUTDOWN_TIMEOUT_MS: String(MIN_SHUTDOWN_TIMEOUT_MS - 1),
    });
    expect(at.ok).toBe(true);
    expect(below.ok).toBe(false);
  });

  it("reports every invalid variable at once", () => {
    const result = parseConfig({ MAX_ROOMS: "abc", PORT: "0" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("MAX_ROOMS");
      expect(result.error).toContain("PORT");
    }
  });
});

describe("main", () => {
  it("refuses to start on an invalid environment", () => {
    const run = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      {
        env: serverEnv({ MAX_ROOMS: "abc", PORT: "0" }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Invalid configuration");
    expect(run.stderr).toContain("MAX_ROOMS");
  });

  describe("the client build", () => {
    const missing = join(tmpdir(), "planning-poker-no-build-here");

    it("refuses to start in production without it, and says why", () => {
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/server/main.ts"],
        {
          env: serverEnv({
            NODE_ENV: "production",
            WEB_ROOT: missing,
            PORT: "3999", // valid; it exits before listening
          }),
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`No client build at ${missing}`);
    });

    it("starts without it in development, as the API alone", async () => {
      const port = await freePort();
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/server/main.ts"],
        { env: serverEnv({ WEB_ROOT: missing, PORT: String(port) }) },
      );
      onTestFinished(() => {
        child.kill();
      });
      await firstLine(child.stdout, "no client build: API only", 4_000);
    });

    it("serves it in production when it is there", async () => {
      const root = mkdtempSync(join(tmpdir(), "planning-poker-build-"));
      writeFileSync(
        join(root, "index.html"),
        "<!doctype html><title>Built</title>",
      );
      const port = await freePort();
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/server/main.ts"],
        {
          env: serverEnv({
            NODE_ENV: "production",
            WEB_ROOT: root,
            PORT: String(port),
            HOST: "127.0.0.1",
          }),
        },
      );
      onTestFinished(() => {
        child.kill();
        rmSync(root, { recursive: true, force: true });
      });
      await firstLine(child.stdout, "Server listening", 4_000);
      const page = await fetch(`http://127.0.0.1:${String(port)}/`, {
        headers: { accept: "text/html" },
      });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<title>Built</title>");
      // Production turns on HSTS (headers.ts), as the config says.
      expect(page.headers.get("strict-transport-security")).toBe(
        "max-age=31536000",
      );
    });
  });

  it("listens on HOST alone", async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      { env: serverEnv({ PORT: String(port), HOST: "127.0.0.1" }) },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    onTestFinished(() => {
      child.kill();
    });
    await firstLine(child.stdout, "Server listening", 4_000);
    const health = await fetch(`http://127.0.0.1:${String(port)}/health`);
    expect(health.status).toBe(200);
    // Without a host, Fastify's "localhost" would listen on ::1 as well.
    await expect(
      fetch(`http://[::1]:${String(port)}/health`),
    ).rejects.toThrow();
    expect(output.match(/Server listening/g)).toEqual(["Server listening"]);
  });

  it("with PROXY=fly, logs the client from Fly-Client-IP", async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      {
        env: serverEnv({
          PORT: String(port),
          HOST: "127.0.0.1",
          LOG_LEVEL: "info",
          PROXY: "fly",
        }),
      },
    );
    onTestFinished(() => {
      child.kill();
    });
    await firstLine(child.stdout, "Server listening", 4_000);
    const logged = firstLine(child.stdout, "incoming request", 4_000);
    await fetch(`http://127.0.0.1:${String(port)}/health`, {
      headers: { "fly-client-ip": "203.0.113.7" },
    });
    const line = JSON.parse(await logged) as {
      req: { remoteAddress: string };
    };
    expect(line.req.remoteAddress).toBe("203.0.113.7");
  });

  it("logs the effective config at startup, so a misspelled variable shows", async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      {
        env: serverEnv({
          PORT: String(port),
          LOG_LEVEL: "info",
          MAX_ROOM: "7", // typo for MAX_ROOMS: ignored, so the default applies
        }),
      },
    );
    // Runs even if the test times out, so a failure never leaks a server.
    onTestFinished(() => {
      child.kill();
    });

    const line = await firstLine(child.stdout, '"configuration"', 4_000);
    const logged = JSON.parse(line) as { config: { limits: unknown } };
    expect(logged.config.limits).toEqual(DEFAULT_LIMITS);
  });
});
