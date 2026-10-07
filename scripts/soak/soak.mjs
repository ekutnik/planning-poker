// A planning session, simulated against a real server: 12 people from one
// address, a round every 2 minutes. 3 real browsers (the real client, its
// pings and reconnection) and 9 bots. Optionally, a restart of the server
// mid-session, as a deploy between rounds would be.
//
//   node scripts/soak/soak.mjs --target local|docker|production
//
// --target is required, so nothing ever runs against production by default
// (scripts/soak/README.md). SOAK_MINUTES sets the length (default 240),
// RESTART_AT the minute of the restart (default none), SOAK_LOG the JSON
// lines log (default soak-<target>.log here). A summary is printed at the
// end, and the exit code is 1 if anything that should never happen did.
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";
import WebSocket from "ws";

const PRODUCTION = "https://estimate-together.fly.dev";
const MACHINE = "7846ed2f3e9608"; // production's one machine
// Where each target's server is, unless BASE says otherwise:
// - local: a production build on this machine (run-local-server.sh), which
//   that runner starts again after the restart's SIGTERM;
// - docker: the server in Docker at production's floor (ab.sh);
// - production: the live app, only ever with --target production.
const TARGETS = {
  local: "http://127.0.0.1:4400",
  docker: "http://127.0.0.1:4600",
  production: PRODUCTION,
};
const flag = process.argv.indexOf("--target");
const TARGET = flag >= 0 ? process.argv[flag + 1] : undefined;
if (!Object.hasOwn(TARGETS, TARGET ?? "")) {
  console.error(
    "usage: node scripts/soak/soak.mjs --target local|docker|production",
  );
  process.exit(2);
}
const BASE = process.env.BASE ?? TARGETS[TARGET];
if (
  TARGET !== "production" &&
  new URL(BASE).host === new URL(PRODUCTION).host
) {
  console.error(`refusing: ${BASE} is production; say --target production`);
  process.exit(2);
}
const CONTAINER = process.env.CONTAINER ?? "pp-ab";

const WSS = BASE.replace(/^http/, "ws");
const RESTART_AT = Number(process.env.RESTART_AT ?? 0) * 60_000;
let restarting = false;
const MIN = 60_000;
const TOTAL = Number(process.env.SOAK_MINUTES ?? 240) * MIN;
const LOG = process.env.SOAK_LOG ?? `soak-${TARGET}.log`;
const CARDS = ["1", "2", "3", "5", "8", "13", "?"];
const t0 = Date.now();
const at = () => ((Date.now() - t0) / MIN).toFixed(2);
const log = (event) =>
  appendFileSync(LOG, JSON.stringify({ min: Number(at()), ...event }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(LOG, "");

const problems = []; // anything that should never happen
const problem = (what) => {
  problems.push({ min: Number(at()), what });
  log({ problem: what });
};

// --- the bots -------------------------------------------------------------
class Bot {
  constructor(name, roomId) {
    this.name = name;
    this.roomId = roomId;
    this.token = randomBytes(24).toString("base64url");
    this.snapshot = null;
    this.expectedClose = false;
    this.closes = [];
    this.revealedAt = null;
    this.attempt = 0;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WSS}/ws/${this.roomId}?v=3`);
      this.ws = ws;
      this.expectedClose = false;
      ws.on("open", () =>
        ws.send(
          JSON.stringify({
            type: "join",
            sessionToken: this.token,
            name: this.name,
          }),
        ),
      );
      ws.on("message", (data) => {
        const m = JSON.parse(String(data));
        if (m.type === "snapshot") {
          this.attempt = 0;
          const was = this.snapshot?.phase;
          this.snapshot = m.snapshot;
          if (m.snapshot.phase === "revealed" && was !== "revealed")
            this.revealedAt = Date.now();
          resolve();
        } else if (m.type === "error") {
          log({ bot: this.name, serverError: m.code });
          if (!["VOTING_CLOSED"].includes(m.code))
            problem(`${this.name} got error ${m.code}`);
        }
      });
      ws.on("close", (code) => {
        this.closes.push(code);
        if (!this.expectedClose) {
          // While the server restarts: its 1001, and refused connections
          // until it is back. Anything else is a problem.
          if (!(restarting && (code === 1001 || code === 1006)))
            problem(`${this.name} closed unexpectedly (${code})`);
          else log({ bot: this.name, restartClose: code });
          // One retry per close, as the real client does: full jitter, 500 ms
          // doubling to 10 s, or 5 s doubling to 2 minutes after 1008/1013
          // (policy.ts). A failed attempt closes too, and schedules the next.
          const [base, cap] =
            code === 1008 || code === 1013 ? [5_000, 120_000] : [500, 10_000];
          const delay = Math.floor(
            Math.random() * Math.min(cap, base * 2 ** this.attempt),
          );
          this.attempt += 1;
          setTimeout(() => this.connect().catch(() => {}), delay);
        }
      });
      ws.on("error", (e) => {
        log({ bot: this.name, wsError: e.message });
        reject(e);
      });
    });
  }
  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(message));
  }
  vote() {
    this.send({
      type: "castVote",
      card: CARDS[Math.floor(Math.random() * CARDS.length)],
    });
  }
  sleepFor(ms) {
    // a laptop lid: the connection just stops, no close frame
    this.expectedClose = true;
    this.ws.terminate();
    log({ bot: this.name, sleeps: ms / 1000 });
    return sleep(ms)
      .then(() => this.connect())
      .then(() =>
        log({
          bot: this.name,
          woke: true,
          participants: this.snapshot.participants.length,
        }),
      );
  }
}

// --- the browsers -----------------------------------------------------------
async function person(browserType, name, { facilitate = false } = {}) {
  const browser = await browserType.launch();
  const context = await browser.newContext({
    baseURL: BASE,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE,
          localStorage: [
            { name: "planning-poker:name", value: name },
            {
              name: "planning-poker:facilitate:v2",
              value: facilitate ? "on" : "off",
            },
          ],
        },
      ],
    },
  });
  const state = {
    name,
    sockets: 0,
    socketCloses: 0,
    closeCodes: [],
    console: 0,
    errors: [],
  };
  await context.exposeBinding("__soakReport", (_s, what) => {
    state.errors.push(what);
    problem(`${name}: ${what}`);
  });
  // The close code and reason the page itself sees, for every socket.
  await context.exposeBinding("__soakClose", (_s, close) => {
    state.closeCodes.push(close.code);
    log({ browser: name, socketClose: close });
  });
  await context.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (e) =>
        window.__soakReport(
          `CSP ${e.effectiveDirective} blocked ${e.blockedURI}`,
        ),
      true,
    );
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("close", (e) =>
          window.__soakClose({
            code: e.code,
            reason: e.reason,
            wasClean: e.wasClean,
          }),
        );
      }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    state.errors.push(e.message);
    problem(`${name}: page error ${e.message}`);
  });
  page.on("console", (m) => {
    state.console += 1;
    log({ browser: name, console: m.type(), text: m.text().slice(0, 300) });
  });
  page.on("websocket", (ws) => {
    state.sockets += 1;
    if (state.sockets > (RESTART_AT ? 2 : 1) && !restarting)
      problem(`${name}: opened socket #${state.sockets}`);
    ws.on("close", () => {
      state.socketCloses += 1;
    });
  });
  return { browser, page, state, name };
}
const card = (p, label) =>
  p.page
    .getByRole("toolbar", { name: "Your card" })
    .getByRole("button", { name: label, exact: true });
async function banner(p) {
  const texts = await p.page.getByRole("status").allInnerTexts();
  return texts.filter((t) => /Reconnect|Connection lost|restarting/i.test(t));
}

// --- memory on the live machine ------------------------------------------------
// local: the listening process, by ps.
function localMemory() {
  try {
    const port = new URL(BASE).port;
    const pid = execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")[0];
    const rss = execFileSync("ps", ["-o", "rss=", "-p", pid], {
      encoding: "utf8",
    }).trim();
    return { rssMiB: Math.round(Number(rss) / 1024), pid: Number(pid) };
  } catch (e) {
    return { error: String(e.message).slice(0, 80) };
  }
}

// production: the node process on the machine, over fly ssh.
function productionMemory() {
  try {
    const out = execFileSync(
      "fly",
      [
        "ssh",
        "console",
        "-a",
        "estimate-together",
        "-C",
        'sh -c \'for d in /proc/[0-9]*; do case "$(tr "\\\\0" " " < $d/cmdline 2>/dev/null)" in "node dist/server/main.js ") grep VmRSS $d/status;; esac; done; grep MemAvailable /proc/meminfo\'',
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const rss = /VmRSS:\s+(\d+)/.exec(out)?.[1];
    const avail = /MemAvailable:\s+(\d+)/.exec(out)?.[1];
    return {
      rssMiB: rss ? Math.round(rss / 1024) : null,
      availableMiB: avail ? Math.round(avail / 1024) : null,
    };
  } catch (e) {
    return { error: String(e.message).slice(0, 80) };
  }
}

// docker: the container, by docker stats.
function dockerMemory() {
  try {
    const out = execFileSync(
      "docker",
      ["stats", "--no-stream", "--format", "{{.MemUsage}}", CONTAINER],
      { encoding: "utf8", timeout: 30_000 },
    );
    return { usage: out.trim().split(" / ")[0] };
  } catch (e) {
    return { error: String(e.message).slice(0, 80) };
  }
}

const serverMemory = {
  local: localMemory,
  docker: dockerMemory,
  production: productionMemory,
}[TARGET];

// --- the session ------------------------------------------------------------------
const { roomId } = await (
  await fetch(`${BASE}/api/rooms`, { method: "POST" })
).json();
log({
  start: new Date().toISOString(),
  roomId: roomId.slice(0, 3) + "…",
  memory: serverMemory(),
});

const facilitator = await person(chromium, "Ada", { facilitate: true });
const others = [await person(firefox, "Ben"), await person(webkit, "Cy")];
const browsers = [facilitator, ...others];
for (const p of browsers) await p.page.goto(`/r/${roomId}`);
const names = ["Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kai", "Lea"];
const bots = names.map((n) => new Bot(n, roomId));
for (const b of bots) await b.connect();
await sleep(2000);
log({ joined: bots[0].snapshot.participants.length });
if (bots[0].snapshot.participants.length !== 12)
  problem(`expected 12 people, saw ${bots[0].snapshot.participants.length}`);

// Two laptops sleep, on their own timers.
const kai = bots.find((b) => b.name === "Kai");
const lea = bots.find((b) => b.name === "Lea");
setTimeout(
  () =>
    kai
      .sleepFor(40_000)
      .then(() => {
        if (kai.snapshot.participants.length !== 12)
          problem(
            `after a 40 s sleep Kai sees ${kai.snapshot.participants.length} people, not 12`,
          );
      })
      .catch((e) => problem(`Kai's wake failed: ${e.message}`)),
  50 * MIN,
);
setTimeout(
  () =>
    lea
      .sleepFor(90_000)
      .then(() =>
        log({
          note: "Lea back after 90 s (removed after the 60 s grace, then rejoined)",
        }),
      )
      .catch((e) => problem(`Lea's wake failed: ${e.message}`)),
  100 * MIN,
);
if (TOTAL > 180 * MIN)
  setTimeout(
    () =>
      kai
        .sleepFor(40_000)
        .then(() => {
          if (kai.snapshot.participants.length !== 12)
            problem(
              `after a second 40 s sleep Kai sees ${kai.snapshot.participants.length} people, not 12`,
            );
        })
        .catch((e) => problem(`Kai's second wake failed: ${e.message}`)),
    170 * MIN,
  );

// Production samples every 10 minutes: each sample blocks for a few seconds over fly ssh.
const memoryTimer = setInterval(
  () => log({ memory: serverMemory() }),
  (TARGET === "production" ? 10 : 5) * MIN,
);
// The restart: at the start of the first round after RESTART_AT, before
// anyone votes, as a deploy between rounds would be. Everyone reconnects at
// once, from one address; the runner starts the server again.
let restarted = false;
async function restartLocal() {
  restarted = true;
  const { pid } = serverMemory();
  restarting = true;
  log({ restart: "SIGTERM", pid });
  process.kill(pid, "SIGTERM");
  await sleep(20_000);
  const seen = bots.map((b) => b.snapshot?.participants.length);
  log({
    restart: "everyone back?",
    memory: serverMemory(),
    participantsSeen: seen,
  });
  setTimeout(() => {
    restarting = false;
    log({ restart: "done" });
  }, 25_000);
}
async function restartProduction() {
  restarted = true;
  restarting = true;
  log({ restart: "fly machine restart", machine: MACHINE });
  // Async: the bots and browsers keep running while Fly restarts it.
  const result = await new Promise((resolve) =>
    execFile(
      "fly",
      ["machine", "restart", MACHINE, "-a", "estimate-together"],
      { timeout: 180_000 },
      (error, stdout) =>
        resolve(
          error
            ? `error: ${String(error.message).slice(0, 120)}`
            : stdout.trim().split("\n").at(-1),
        ),
    ),
  );
  log({ restart: "fly says", result });
  await sleep(40_000);
  const seen = bots.map((b) => b.snapshot?.participants.length);
  log({
    restart: "everyone back?",
    memory: serverMemory(),
    participantsSeen: seen,
  });
  setTimeout(() => {
    restarting = false;
    log({ restart: "done" });
  }, 30_000);
}
async function restartDocker() {
  restarted = true;
  restarting = true;
  log({ restart: "docker restart", container: CONTAINER });
  const result = await new Promise((resolve) =>
    execFile(
      "docker",
      ["restart", "-t", "15", CONTAINER],
      { timeout: 180_000 },
      (error) =>
        resolve(
          error ? `error: ${String(error.message).slice(0, 120)}` : "restarted",
        ),
    ),
  );
  log({ restart: "docker says", result });
  await sleep(40_000);
  const seen = bots.map((b) => b.snapshot?.participants.length);
  log({
    restart: "everyone back?",
    memory: serverMemory(),
    participantsSeen: seen,
  });
  setTimeout(() => {
    restarting = false;
    log({ restart: "done" });
  }, 30_000);
}
const restartServer = {
  local: restartLocal,
  docker: restartDocker,
  production: restartProduction,
}[TARGET];
// The banner timeline: every 5 s, log any browser whose banner changed.
const lastBanner = new Map();
const bannerTimer = setInterval(async () => {
  for (const p of browsers) {
    const now = JSON.stringify(
      await banner(p).catch(() => ["(page unreadable)"]),
    );
    if (now !== (lastBanner.get(p.name) ?? "[]")) {
      lastBanner.set(p.name, now);
      log({ browser: p.name, bannerNow: JSON.parse(now) });
    }
  }
}, 5_000);
let round = 0;
let discussions = 0;
const revealLatencies = [];
while (Date.now() - t0 < TOTAL - 3 * MIN) {
  round += 1;
  if (RESTART_AT && !restarted && Date.now() - t0 > RESTART_AT)
    await restartServer();
  const start = Date.now();
  // Voting: everyone votes within the first minute.
  for (const b of bots)
    setTimeout(() => b.vote(), 5_000 + Math.random() * 50_000);
  await sleep(15_000);
  for (const p of browsers) {
    await card(p, CARDS[round % CARDS.length])
      .click()
      .catch((e) =>
        problem(`${p.name} couldn't vote: ${e.message.split("\n")[0]}`),
      );
  }
  await sleep(Math.max(0, 90_000 - (Date.now() - start)));
  // Reveal, by the facilitator on the shared screen.
  for (const b of bots) b.revealedAt = null;
  const clicked = Date.now();
  await facilitator.page
    .getByRole("button", { name: "Reveal votes" })
    .click()
    .catch((e) => problem(`reveal click failed: ${e.message.split("\n")[0]}`));
  await sleep(5_000);
  const late = bots
    .filter((b) => b.revealedAt === null && b.ws?.readyState === WebSocket.OPEN)
    .map((b) => b.name);
  const worst = Math.max(
    ...bots.filter((b) => b.revealedAt).map((b) => b.revealedAt - clicked),
  );
  revealLatencies.push(worst);
  const shown = await Promise.all(
    browsers.map((p) =>
      p.page
        .getByRole("heading", { level: 1 })
        .innerText()
        .catch(() => "?"),
    ),
  );
  const banners = (await Promise.all(browsers.map(banner))).flat();
  log({
    round,
    worstRevealMs: worst,
    late,
    browserHeadings: shown,
    people: bots[0].snapshot?.participants.length,
    banners,
  });
  if (late.length)
    problem(
      `round ${round}: ${late.join(", ")} didn't see the reveal within 5 s`,
    );
  if (shown.some((h) => h !== "Votes revealed"))
    problem(`round ${round}: a browser shows ${JSON.stringify(shown)}`);
  if (banners.length)
    problem(`round ${round}: banner ${JSON.stringify(banners)}`);
  // A long discussion after two of the reveals: 15 quiet minutes.
  const elapsed = (Date.now() - t0) / MIN;
  const discussionAt = [25, 80, 140, 195]; // minutes; only those that fit before the end
  if (
    discussions < discussionAt.length &&
    elapsed > discussionAt[discussions] &&
    elapsed + 20 < TOTAL / MIN
  ) {
    discussions += 1;
    log({ discussion: discussions, minutes: 15 });
    await sleep(15 * MIN);
    const after = (await Promise.all(browsers.map(banner))).flat();
    log({
      afterDiscussion: discussions,
      sockets: browsers.map((p) => ({
        name: p.name,
        opened: p.state.sockets,
        closed: p.state.socketCloses,
      })),
      banners: after,
    });
    if (after.length)
      problem(
        `after discussion ${discussions}: banner ${JSON.stringify(after)}`,
      );
  } else {
    await sleep(Math.max(0, 120_000 - (Date.now() - start)));
  }
  await facilitator.page
    .getByRole("button", { name: "Start next round" })
    .click()
    .catch((e) =>
      problem(`next round click failed: ${e.message.split("\n")[0]}`),
    );
  await sleep(2_000);
}
clearInterval(memoryTimer);
clearInterval(bannerTimer);

const summary = {
  minutes: Number(at()),
  rounds: round,
  discussions,
  revealMs: {
    median: revealLatencies.sort((a, b) => a - b)[
      Math.floor(revealLatencies.length / 2)
    ],
    worst: Math.max(...revealLatencies),
  },
  browsers: browsers.map((p) => ({
    name: p.name,
    socketsOpened: p.state.sockets,
    socketsClosed: p.state.socketCloses,
    closeCodes: p.state.closeCodes,
    consoleMessages: p.state.console,
    errors: p.state.errors.length,
  })),
  botUnexpectedCloses: bots
    .map((b) => ({ name: b.name, closes: b.closes }))
    .filter((b) => b.closes.length),
  memoryEnd: serverMemory(),
  problems,
};
log({ summary });
console.log(JSON.stringify(summary, null, 1));
for (const b of bots) {
  b.expectedClose = true;
  b.send({ type: "leave" });
  b.ws?.close();
}
for (const p of browsers) await p.browser.close();
process.exit(problems.length ? 1 : 0);
