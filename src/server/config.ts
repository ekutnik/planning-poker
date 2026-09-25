import * as z from "zod";
import { DEFAULT_LIMITS } from "./app.js";
import {
  JOIN_TIMEOUT_MS,
  ROOM_TTL_MS,
  SWEEP_INTERVAL_MS,
  type Limits,
} from "./room-service.js";

const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;

const whole = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max);

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
  // Every deadline fires up to one interval late, so an interval longer than
  // the shortest deadline (the join timeout) would make that deadline
  // meaningless. Below 100ms the sweep is close to a busy loop.
  SWEEP_INTERVAL_MS: whole(100, JOIN_TIMEOUT_MS).default(SWEEP_INTERVAL_MS),
  ROOM_TTL_MS: whole(1).default(ROOM_TTL_MS),
});

export interface Config {
  readonly port: number;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly limits: Limits;
  readonly sweepIntervalMs: number;
  readonly roomTtlMs: number;
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
    },
  };
}
