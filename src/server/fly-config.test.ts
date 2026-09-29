import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { SHUTDOWN_TIMEOUT_MS } from "./config.js";

/**
 * fly.toml sets what the app costs, and Fly has no spending cap or billing
 * alert. The budget is one always-on shared-cpu-1x machine with 256 MB in
 * Frankfurt, about $2.24 a month: this fails on any change that would
 * quietly cost more, so raising it is a decision made in review.
 */

const config = parse(
  readFileSync(new URL("../../fly.toml", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("fly.toml stays within the budget", () => {
  it("is one small machine: shared-cpu-1x with 256 MB", () => {
    expect(config.vm).toEqual([{ size: "shared-cpu-1x", memory: "256mb" }]);
  });

  it("runs in one region, Frankfurt", () => {
    expect(config.primary_region).toBe("fra");
  });

  it("keeps that one machine running, and never starts another", () => {
    expect(config.http_service).toMatchObject({
      min_machines_running: 1,
      auto_stop_machines: "off",
      auto_start_machines: false,
    });
  });

  it("has nothing that adds machines or bills while stopped", () => {
    // [processes] and [[services]] can each add machines; a volume bills
    // even while its machine is stopped.
    for (const section of ["processes", "services", "mounts"]) {
      expect(config, section).not.toHaveProperty(section);
    }
  });

  it("restarts the one machine's process after a crash", () => {
    expect(config.restart).toEqual([{ policy: "on-failure", retries: 10 }]);
  });

  it("gives the graceful shutdown time to finish", () => {
    expect(config.kill_timeout).toBeGreaterThan(SHUTDOWN_TIMEOUT_MS / 1000);
  });

  it("caps Node's heap below the machine's 207 MiB, and holds at most 200 rooms, so full rooms fit in it", () => {
    // Measured: 200 rooms of 30, plus 1,000 sockets not yet joined, use
    // 86.9 MiB of heap; the default 10,000 rooms would run out of it.
    expect(config.env).toMatchObject({
      NODE_OPTIONS: "--max-old-space-size=128",
      MAX_ROOMS: "200",
    });
  });
});
