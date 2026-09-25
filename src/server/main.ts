import { buildServer } from "./app.js";
import { parseConfig } from "./config.js";

// Fail fast: refuse to start on an invalid environment, before building anything.
const parsed = parseConfig(process.env);
if (!parsed.ok) {
  console.error(`Invalid configuration:\n${parsed.error}`);
  process.exit(1);
}
const { config } = parsed;

const app = buildServer({
  logger: { level: config.logLevel },
  limits: config.limits,
  sweepIntervalMs: config.sweepIntervalMs,
  roomTtlMs: config.roomTtlMs,
});

try {
  await app.listen({ port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
