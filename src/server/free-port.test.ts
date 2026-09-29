import { once } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { freePort } from "./child.testing.js";

/**
 * The ports child servers listen on (child.testing.ts): outside the range
 * the OS hands to outgoing connections, and never one already in use.
 */

describe("freePort", () => {
  it("is below the ephemeral range, and a new port each time", async () => {
    const first = await freePort();
    const second = await freePort();
    expect(first).toBeLessThan(49_152);
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
