import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./app.js";
import { parseConfig } from "./config.js";
import { onShutdownSignal } from "./shutdown.js";

// Fail fast: refuse to start on an invalid environment, before building anything.
const parsed = parseConfig(process.env);
if (!parsed.ok) {
  console.error(`Invalid configuration:\n${parsed.error}`);
  process.exit(1);
}
const { config } = parsed;

// The built client (npm run build:web). In development there is usually
// none, and Vite serves the page, so the server is the API alone. In
// production that would be a silent failure: /health passes, the deploy
// goes green, and every visitor gets an empty 404. So there, as with a bad
// setting, the server refuses to start.
const webRoot =
  config.webRoot ?? fileURLToPath(new URL("../../dist/web/", import.meta.url));
const serving = existsSync(join(webRoot, "index.html"));
if (!serving && config.production) {
  console.error(
    `No client build at ${webRoot}. In production the server must serve ` +
      "the client: run npm run build:web, or check that the image copies " +
      "dist/web (or set WEB_ROOT to where it is).",
  );
  process.exit(1);
}

const app = buildServer({
  webRoot: serving ? webRoot : undefined,
  logger: { level: config.logLevel },
  limits: config.limits,
  sweepIntervalMs: config.sweepIntervalMs,
  roomTtlMs: config.roomTtlMs,
});
// A misspelled variable (MAX_ROOM=5) is simply absent, so its default
// applies; logging the effective config once is how an operator notices.
// Nothing in it is secret.
app.log.info({ config }, "configuration");
app.log.info(
  serving ? { webRoot } : {},
  serving ? "serving the built client" : "no client build: API only",
);

// Shutdown (#29): see onShutdownSignal. Registered before listen, so a
// signal during startup still closes the server and exits.
const shutdown = onShutdownSignal({
  close: () => app.close(),
  exit: (code) => process.exit(code),
  after: (ms, callback) => {
    setTimeout(callback, ms).unref();
  },
  log: app.log,
  timeoutMs: config.shutdownTimeoutMs,
});
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
