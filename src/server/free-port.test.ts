import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { platform } from "node:os";
import { describe, expect, it, onTestFinished } from "vitest";
import { freePort } from "./child.testing.js";

/**
 * The ports child servers listen on (child.testing.ts): outside the range
 * the OS hands to outgoing connections, and never one already in use.
 */

/** The first port of this OS's ephemeral range, read from the OS itself. */
function ephemeralFrom(): number {
  // Linux (CI): 32768 by default. macOS: 49152.
  if (platform() === "linux") {
    const range = readFileSync(
      "/proc/sys/net/ipv4/ip_local_port_range",
      "utf8",
    );
    return Number(range.trim().split(/\s+/)[0]);
  }
  return Number(
    execFileSync("sysctl", ["-n", "net.inet.ip.portrange.first"], {
      encoding: "utf8",
    }).trim(),
  );
}

describe("freePort", () => {
  it("is below this OS's ephemeral range, and a new port each time", async () => {
    const first = await freePort();
    const second = await freePort();
    expect(Math.max(first, second)).toBeLessThan(ephemeralFrom());
    expect(second).not.toBe(first);
  });

  it("skips a port something else is listening on", async () => {
    const before = await freePort();
    const taken = createServer().listen(before + 1);
    await once(taken, "listening");
    onTestFinished(() => {
      taken.close();
    });
    expect(await freePort()).toBe(before + 2);
  });
});
