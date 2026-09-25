import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "./app.js";
import { parseConfig } from "./config.js";
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
      }),
    ).toEqual({
      ok: true,
      config: {
        port: 8080,
        logLevel: "warn",
        limits: { maxRooms: 50, maxPending: 20 },
        sweepIntervalMs: 1000,
        roomTtlMs: 60_000,
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
});
