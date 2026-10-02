import { isIP } from "node:net";

/** The one key every address that isn't one shares: strict, on purpose. */
export const INVALID_KEY = "invalid";

/**
 * The key the per-address limits count under (ADR 0009), from the client's
 * address as clientIp() reports it:
 *
 * - IPv4 as it is, and an IPv4-mapped IPv6 address ("::ffff:1.2.3.4") as
 *   the IPv4 address it is;
 * - IPv6 by its /64: one household or one phone network usually holds a
 *   whole /64, so keying on the full address would make every limit free to
 *   get around. Written out in full, so every spelling of one /64 is one key;
 * - anything else, a missing address included, shares INVALID_KEY.
 *
 * A key is never logged: it is an address, and the request's own log line
 * already has that.
 */
export function limitKey(address: string | undefined): string {
  if (address === undefined) return INVALID_KEY;
  // A zone ("fe80::1%eth0") names an interface on this machine, not a client.
  const bare = address.split("%")[0] ?? "";
  const version = isIP(bare);
  if (version === 4) return bare;
  if (version !== 6) return INVALID_KEY;
  const groups = expandIPv6(bare.toLowerCase());
  if (groups === null) return INVALID_KEY;
  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const [high = 0, low = 0] = groups.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

/**
 * The eight 16-bit groups of a valid IPv6 address, expanding "::" and a
 * dotted IPv4 tail. Null if it isn't one, which isIP has already ruled out.
 */
function expandIPv6(address: string): number[] | null {
  let text = address;
  // A dotted IPv4 tail ("::ffff:1.2.3.4") is the last two groups.
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    const tail = [
      (((a ?? 0) << 8) | (b ?? 0)).toString(16),
      (((c ?? 0) << 8) | (d ?? 0)).toString(16),
    ].join(":");
    text = text.slice(0, dotted.index) + tail;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) =>
    part === undefined || part === "" ? [] : part.split(":");
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail].map(
    (group) => Number.parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff)
    ? groups
    : null;
}
