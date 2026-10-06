import { describe, expect, it } from "vitest";
import { AddressLimits } from "./address.js";

const limits = () =>
  new AddressLimits({ connectsPerMinute: 60, socketsPerAddress: 3 });

describe("the limits per address (ADR 0009)", () => {
  it("allows 60 upgrades a minute per key, each key on its own", () => {
    const address = limits();
    for (let i = 0; i < 60; i += 1) expect(address.upgrade("a", 0)).toBe("ok");
    expect(address.upgrade("a", 0)).toBe("limited");
    expect(address.upgrade("b", 0)).toBe("ok");
    expect(address.upgrade("a", 1_000)).toBe("ok"); // one a second comes back
  });

  it("allows room ids from the API at the same rate, and says how long to wait", () => {
    const address = limits();
    for (let i = 0; i < 60; i += 1) address.roomId("a", 0);
    expect(address.roomId("a", 0)).toEqual({
      take: "limited",
      retryAfterMs: 1_000,
    });
    // A separate bucket from the upgrades.
    expect(address.upgrade("a", 0)).toBe("ok");
  });

  it("counts open sockets per key, and back to nothing as they close", () => {
    const address = limits();
    for (let i = 0; i < 3; i += 1) {
      expect(address.roomForSocket("a")).toBe("ok");
      address.open("a");
    }
    expect(address.roomForSocket("a")).toBe("limited");
    expect(address.roomForSocket("b")).toBe("ok");
    address.close("a");
    expect(address.roomForSocket("a")).toBe("ok");
    address.close("a");
    address.close("a");
    expect(address.bookkeeping().sockets).toBe(0);
  });

  it("never sweeps a key that still has sockets open", () => {
    const address = limits();
    address.upgrade("a", 0);
    address.open("a");
    address.upgrade("b", 0);
    address.sweep(10 * 60_000);
    // "b" refilled and went; "a" refilled but has a socket, so it stays.
    expect(address.bookkeeping().keys).toBe(2); // a's bucket, a's count
    address.close("a");
    address.sweep(10 * 60_000);
    expect(address.bookkeeping()).toEqual({ sockets: 0, keys: 0 });
  });
});
