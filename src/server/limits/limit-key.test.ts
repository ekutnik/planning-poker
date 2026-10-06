import { describe, expect, it } from "vitest";
import { INVALID_KEY, limitKey } from "./limit-key.js";

describe("the per-address limits' key (ADR 0009)", () => {
  it("keys IPv4 on the address", () => {
    expect(limitKey("203.0.113.7")).toBe("203.0.113.7");
    expect(limitKey("203.0.113.8")).not.toBe(limitKey("203.0.113.7"));
  });

  it("keys an IPv4-mapped IPv6 address as the IPv4 address it is", () => {
    expect(limitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(limitKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(limitKey("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("keys IPv6 on its /64, however the address is written", () => {
    const key = limitKey("2001:db8:85a3:12::1");
    expect(key).toBe("2001:db8:85a3:12::/64");
    for (const sameNetwork of [
      "2001:db8:85a3:12:ffff:ffff:ffff:ffff",
      "2001:0db8:85a3:0012:0000:0000:0000:0002",
      "2001:DB8:85A3:12:abcd::",
      "2001:db8:85a3:12::1%eth0",
    ]) {
      expect(limitKey(sameNetwork)).toBe(key);
    }
  });

  it("gives two /64s two keys", () => {
    expect(limitKey("2001:db8:85a3:12::1")).not.toBe(
      limitKey("2001:db8:85a3:13::1"),
    );
    expect(limitKey("::1")).toBe("0:0:0:0::/64");
    expect(limitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("gives anything that isn't an address one strict key", () => {
    for (const garbage of [
      undefined,
      "",
      "localhost",
      "1.2.3",
      "256.1.1.1",
      "2001:db8::1::2",
      "x".repeat(100),
    ]) {
      expect(limitKey(garbage)).toBe(INVALID_KEY);
    }
  });
});
