import * as z from "zod";
import {
  DEFAULT_LIMITS,
  JOIN_TIMEOUT_MS,
  MAX_SWEEP_INTERVAL_MS,
  ROOM_TTL_MS,
  SWEEP_INTERVAL_MS,
  type Limits,
} from "./room-service.js";
import { PROXIES, type Proxy } from "./client-ip.js";
import { CLOSE_GRACE_MS } from "./shutdown.js";

/**
 * A shutdown still running after this long exits anyway, with 1 (#29). The
 * sockets have CLOSE_GRACE_MS to close, so a normal shutdown takes at most
 * about two seconds; this is the backstop.
 */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * The shortest SHUTDOWN_TIMEOUT_MS allowed: the close grace plus a second.
 * Any shorter, and a shutdown with one closed laptop in a room would hit the
 * timeout before the grace could drop it, so every deploy would exit with 1
 * and the backstop would fire routinely.
 */
export const MIN_SHUTDOWN_TIMEOUT_MS = CLOSE_GRACE_MS + 1_000;

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

/**
 * Plain decimal digits only. z.coerce.number() would go through Number(),
 * which also accepts "0x10", "1e4" and " 5 ", so MAX_ROOMS=0x10 would quietly
 * mean 16.
 */
const whole = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .regex(/^\d+$/, "expected a whole number in plain decimal digits")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

/**
 * Everything the server reads from its environment (#18). Unset means the
 * default; set but invalid, including set to an empty string, refuses to
 * start. A server that quietly falls back on MAX_ROOMS=abc is worse than one
 * that won't start.
 */
const Env = z.object({
  PORT: whole(1, 65_535).default(3000),
  // The address to listen on, as an IP address. 127.0.0.1 by default, so a
  // dev server is never reachable from the network. In a container that is
  // the container itself, out of the platform proxy's reach: the Dockerfile
  // sets 0.0.0.0. Not a hostname: "localhost" can mean ::1 or 127.0.0.1,
  // and Fastify would listen on both.
  HOST: z
    .union([z.ipv4(), z.ipv6()], {
      error: "expected an IP address, such as 127.0.0.1 or 0.0.0.0",
    })
    .default("127.0.0.1"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  MAX_ROOMS: whole(1).default(DEFAULT_LIMITS.maxRooms),
  MAX_PENDING: whole(1).default(DEFAULT_LIMITS.maxPending),
  // Two ceilings, whichever is lower: MAX_SWEEP_INTERVAL_MS keeps a healthy
  // connection inside the pong deadline through an undetected stall, and the
  // join timeout would be meaningless if it could fire a whole interval late
  // with an interval longer than itself. Below 100ms it is close to a busy loop.
  SWEEP_INTERVAL_MS: whole(
    100,
    Math.min(MAX_SWEEP_INTERVAL_MS, JOIN_TIMEOUT_MS),
  ).default(SWEEP_INTERVAL_MS),
  ROOM_TTL_MS: whole(1).default(ROOM_TTL_MS),
  // How long a shutdown may take before the process exits anyway (#29).
  SHUTDOWN_TIMEOUT_MS: whole(MIN_SHUTDOWN_TIMEOUT_MS).default(
    SHUTDOWN_TIMEOUT_MS,
  ),
  // "production" makes a missing client build fatal (see main.ts); any
  // other value, or none, is development.
  NODE_ENV: z.string().optional(),
  // Where the built client is; unset means dist/web beside the source.
  WEB_ROOT: z.string().min(1).optional(),
  // The proxy in front, whose header names the client (client-ip.ts). Set
  // only where that proxy really is: "fly" in fly.toml. Anywhere else a
  // client could send the header itself.
  PROXY: z.enum(PROXIES).optional(),
});

export interface Config {
  readonly port: number;
  readonly host: string;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly limits: Limits;
  readonly sweepIntervalMs: number;
  readonly roomTtlMs: number;
  readonly shutdownTimeoutMs: number;
  readonly production: boolean;
  readonly webRoot: string | undefined;
  readonly proxy: Proxy | undefined;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly error: string };

/** Never throws: an invalid environment is a value naming every bad variable. */
export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
): ConfigResult {
  const result = Env.safeParse(env);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) };
  }
  const vars = result.data;
  return {
    ok: true,
    config: {
      port: vars.PORT,
      host: vars.HOST,
      logLevel: vars.LOG_LEVEL,
      limits: { maxRooms: vars.MAX_ROOMS, maxPending: vars.MAX_PENDING },
      sweepIntervalMs: vars.SWEEP_INTERVAL_MS,
      roomTtlMs: vars.ROOM_TTL_MS,
      shutdownTimeoutMs: vars.SHUTDOWN_TIMEOUT_MS,
      production: vars.NODE_ENV === "production",
      webRoot: vars.WEB_ROOT,
      proxy: vars.PROXY,
    },
  };
}
