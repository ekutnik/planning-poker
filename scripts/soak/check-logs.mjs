// The production target's log check. Reads what `fly logs -a
// estimate-together > prod-logs.txt` captured during a run: each app line
// ends with the server's JSON line. Reports the newest process's config
// line (the limits it runs with), its /health lines (there should be none),
// its counts lines, and, between two times, the rate-limited, suppressed
// and warn-or-worse lines.
//
//   node scripts/soak/check-logs.mjs prod-logs.txt [fromISO] [toISO]
import { readFileSync } from "node:fs";
const [file, from, to] = process.argv.slice(2);
// fly logs colours its output: strip the ANSI escapes.
// eslint-disable-next-line no-control-regex -- the escape character is the point
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const entries = [];
for (const raw of readFileSync(file, "utf8").split("\n")) {
  const line = strip(raw);
  const i = line.indexOf('{"level"');
  if (i < 0) continue;
  try {
    entries.push(JSON.parse(line.slice(i)));
  } catch {
    // A line that only looks like JSON: not the server's, so skipped.
  }
}
const start = from ? Date.parse(from) : 0,
  end = to ? Date.parse(to) : Infinity;
const inWindow = entries.filter((e) => e.time >= start && e.time < end);
const configs = entries.filter((e) => e.msg === "configuration");
const lastConfig = configs.at(-1);
const newPid = lastConfig?.pid;
const sinceNew = entries.filter(
  (e) => e.pid === newPid && e.time >= (lastConfig?.time ?? 0),
);
console.log(
  JSON.stringify(
    {
      linesParsed: entries.length,
      newProcess: lastConfig
        ? {
            pid: newPid,
            at: new Date(lastConfig.time).toISOString(),
            limits: lastConfig.config?.limits,
            logLevel: lastConfig.config?.logLevel,
          }
        : null,
      healthLinesSinceNewProcess: sinceNew.filter(
        (e) =>
          e.req?.url === "/health" ||
          /health/.test(JSON.stringify(e.req ?? "")),
      ).length,
      countsSinceNewProcess: sinceNew
        .filter((e) => e.type === "counts")
        .map(({ level, time, pid, hostname, ...c }) => ({
          at: new Date(time).toISOString(),
          ...c,
        })),
      window: {
        from: from ?? null,
        to: to ?? null,
        lines: inWindow.length,
        rateLimited: inWindow.filter((e) => e.type === "rate-limited").length,
        suppressed: inWindow.filter((e) => e.type === "suppressed").length,
        warnOrWorse: inWindow
          .filter((e) => e.level >= 40)
          .map((e) => e.type ?? e.msg),
      },
    },
    null,
    1,
  ),
);
