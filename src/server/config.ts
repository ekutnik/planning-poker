import * as z from "zod";
import { DEFAULT_LIMITS } from "./app.js";
import {
  JOIN_TIMEOUT_MS,
  MAX_SWEEP_INTERVAL_MS,
  ROOM_TTL_MS,
  SWEEP_INTERVAL_MS,
  type Limits,
} from "./room-service.js";

/**
 * A shutdown still running after this long exits anyway, with 1 (#29). The
 * sockets have CLOSE_GRACE_MS to close, so a normal shutdown takes at most
 * about two seconds; this is the backstop.
 */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

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
  SHUTDOWN_TIMEOUT_MS: whole(1).default(SHUTDOWN_TIMEOUT_MS),
  // "production" makes a missing client build fatal (see main.ts); any
  // other value, or none, is development.
  NODE_ENV: z.string().optional(),
  // Where the built client is; unset means dist/web beside the source.
  WEB_ROOT: z.string().min(1).optional(),
});

export interface Config {
  readonly port: number;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly limits: Limits;
  readonly sweepIntervalMs: number;
  readonly roomTtlMs: number;
  readonly shutdownTimeoutMs: number;
  readonly production: boolean;
  readonly webRoot: string | undefined;
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
      logLevel: vars.LOG_LEVEL,
      limits: { maxRooms: vars.MAX_ROOMS, maxPending: vars.MAX_PENDING },
      sweepIntervalMs: vars.SWEEP_INTERVAL_MS,
      roomTtlMs: vars.ROOM_TTL_MS,
      shutdownTimeoutMs: vars.SHUTDOWN_TIMEOUT_MS,
      production: vars.NODE_ENV === "production",
      webRoot: vars.WEB_ROOT,
    },
  };
}
