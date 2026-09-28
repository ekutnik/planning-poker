import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { CLOSE_GRACE_MS, DEFAULT_LIMITS } from "./app.js";
import { freePort, firstLine } from "./child.testing.js";
import {
  MIN_SHUTDOWN_TIMEOUT_MS,
  parseConfig,
  SHUTDOWN_TIMEOUT_MS,
} from "./config.js";
import {
  MAX_SWEEP_INTERVAL_MS,
  ROOM_TTL_MS,
  SWEEP_INTERVAL_MS,
} from "./room-service.js";

describe("parseConfig (#18)", () => {
  it("uses the defaults when nothing is set, and ignores unrelated variables", () => {
    expect(parseConfig({ HOME: "/home/someone", PATH: "/usr/bin" })).toEqual({
      ok: true,
      config: {
        port: 3000,
        logLevel: "info",
        limits: DEFAULT_LIMITS,
        sweepIntervalMs: SWEEP_INTERVAL_MS,
        roomTtlMs: ROOM_TTL_MS,
        shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
        production: false,
        webRoot: undefined,
      },
    });
  });

  it("reads every setting", () => {
    expect(
      parseConfig({
        PORT: "8080",
        LOG_LEVEL: "warn",
        MAX_ROOMS: "50",
        MAX_PENDING: "20",
        SWEEP_INTERVAL_MS: "1000",
        ROOM_TTL_MS: "60000",
        SHUTDOWN_TIMEOUT_MS: "5000",
        NODE_ENV: "production",
        WEB_ROOT: "/srv/web",
      }),
    ).toEqual({
      ok: true,
      config: {
        port: 8080,
        logLevel: "warn",
        limits: { maxRooms: 50, maxPending: 20 },
        sweepIntervalMs: 1000,
        roomTtlMs: 60_000,
        shutdownTimeoutMs: 5000,
        production: true,
        webRoot: "/srv/web",
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
        env: { ...process.env, MAX_ROOMS: "abc", PORT: "0" },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Invalid configuration");
    expect(run.stderr).toContain("MAX_ROOMS");
  });

  describe("the client build", () => {
    // Vitest runs with NODE_ENV=test; each case sets its own.
    const { NODE_ENV: _ignored, ...base } = process.env;
    const missing = join(tmpdir(), "planning-poker-no-build-here");

    it("refuses to start in production without it, and says why", () => {
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/server/main.ts"],
        {
          env: {
            ...base,
            NODE_ENV: "production",
            WEB_ROOT: missing,
            PORT: "3999", // valid; it exits before listening
          },
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
        { env: { ...base, WEB_ROOT: missing, PORT: String(port) } },
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
          env: {
            ...base,
            NODE_ENV: "production",
            WEB_ROOT: root,
            PORT: String(port),
          },
        },
      );
      onTestFinished(() => {
        child.kill();
        rmSync(root, { recursive: true, force: true });
      });
      // Fastify listens on ::1 and 127.0.0.1 and logs each: wait for the
      // one fetched from, or it can be refused in between.
      await firstLine(
        child.stdout,
        "Server listening at http://127.0.0.1",
        4_000,
      );
      const page = await fetch(`http://127.0.0.1:${String(port)}/`, {
        headers: { accept: "text/html" },
      });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<title>Built</title>");
    });
  });

  it("logs the effective config at startup, so a misspelled variable shows", async () => {
    const port = await freePort();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/server/main.ts"],
      {
        env: {
          ...process.env,
          PORT: String(port),
          LOG_LEVEL: "info",
          MAX_ROOM: "7", // typo for MAX_ROOMS: ignored, so the default applies
        },
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
