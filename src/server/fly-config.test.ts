import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHUTDOWN_TIMEOUT_MS } from "./config.js";

/**
 * fly.toml sets what the app costs, and Fly has no spending cap or billing
 * alert. The budget is one always-on shared-cpu-1x machine with 256 MB in
 * Frankfurt, about $2.24 a month: this fails on any change that would
 * quietly cost more, so raising it is a decision made in review.
 */

const toml = readFileSync(new URL("../../fly.toml", import.meta.url), "utf8");

/** The uncommented lines, so a comment can't satisfy or break a check. */
const lines = toml
  .split("\n")
  .map((line) => line.replace(/#.*$/, "").trim())
  .filter((line) => line !== "");

/** The value of `key = value` in the table named `table` ("" for the top). */
function value(table: string, key: string): string | undefined {
  let current = "";
  for (const line of lines) {
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      current = header[1] ?? "";
      continue;
    }
    const pair = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (current === table && pair?.[1] === key) return pair[2];
  }
  return undefined;
}

describe("fly.toml stays within the budget", () => {
  it("is one small machine: shared-cpu-1x with 256 MB", () => {
    expect(value("vm", "size")).toBe('"shared-cpu-1x"');
    expect(value("vm", "memory")).toBe('"256mb"');
    expect(lines.filter((line) => line === "[[vm]]")).toHaveLength(1);
  });

  it("runs in one region, Frankfurt", () => {
    expect(value("", "primary_region")).toBe('"fra"');
  });

  it("keeps that one machine running, and never starts another", () => {
    expect(value("http_service", "min_machines_running")).toBe("1");
    expect(value("http_service", "auto_stop_machines")).toBe('"off"');
    expect(value("http_service", "auto_start_machines")).toBe("false");
  });

  it("has no volume, which would bill even while stopped", () => {
    expect(lines.some((line) => /^\[\[?mounts\]\]?$/.test(line))).toBe(false);
  });

  it("gives the graceful shutdown time to finish, and caps Node's heap below the machine's 207 MiB", () => {
    expect(Number(value("", "kill_timeout"))).toBeGreaterThan(
      SHUTDOWN_TIMEOUT_MS / 1000,
    );
    expect(value("env", "NODE_OPTIONS")).toBe('"--max-old-space-size=128"');
  });

  it("holds at most 200 rooms, so full rooms fit in that heap", () => {
    // Measured: 200 rooms of 30, plus 1,000 sockets not yet joined, use
    // 86.9 MiB of heap; the default 10,000 rooms would run out of it.
    expect(value("env", "MAX_ROOMS")).toBe('"200"');
  });
});
