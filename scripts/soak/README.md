# The session simulation

`soak.mjs` simulates a planning session against a real server: 12 people from one address, a round every 2 minutes, for `SOAK_MINUTES` (30 for a release). Three are real browsers (Chromium as the facilitator, Firefox and WebKit), running the real client with its pings and reconnection; nine are bots on raw WebSockets. With `RESTART_AT`, the server is restarted at the start of the first round after that minute, before anyone votes, as a deploy between rounds would be. Everyone then reconnects at once, from one address.

Every release's figures for rounds, reveals, memory and refusals come from this script.

## Running it

`--target` is required. Nothing runs against production unless it says so, and the production address is refused under any other target.

| Target       | The server                                                      | Memory from                                                                               | The restart                                    | Run with                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`      | the production build on this machine, port 4400                 | `ps`                                                                                      | SIGTERM; `run-local-server.sh` starts it again | `npm run build:web && npm run build:server`, then `scripts/soak/run-local-server.sh /tmp/soak/server.log &`, then `SOAK_MINUTES=30 RESTART_AT=16 node scripts/soak/soak.mjs --target local`                                                         |
| `docker`     | a release's image at production's floor: 1/16 of a CPU, 207 MiB | `docker stats`                                                                            | `docker restart`                               | `scripts/soak/ab.sh v0.4.0 v0.5.0` runs both, one after the other                                                                                                                                                                                   |
| `production` | the live app                                                    | the node process, over `fly ssh` (every 10 minutes: each sample blocks for a few seconds) | `fly machine restart`                          | the deploy rules apply: after a release, nobody connected, never during a planning session; capture `fly logs -a estimate-together > prod-logs.txt` throughout; then `SOAK_MINUTES=30 RESTART_AT=16 node scripts/soak/soak.mjs --target production` |

The log is JSON lines, in `soak-<target>.log` here, or in `SOAK_LOG`. One line per round, plus memory, restarts and any problem; the summary is printed at the end.

**Rooms count against the per-address limits** (ADR 0009): a run creates one room from this address, and the live checks before it make more. Ten an hour is the limit, so keep anything else that makes rooms from here to a few.

## What it measures

- **A reveal, from the facilitator's click to each bot's snapshot.** The clock starts when the script asks the facilitator's browser to click Reveal votes, and stops for each bot when its first revealed snapshot arrives. So a reveal includes Playwright's click, both network legs (the facilitator up to the server, the server down to each bot) and the server's own work. Each round logs its slowest bot (`worstRevealMs`), and any bot that hadn't got the reveal after 5 s (`late`). The summary's `revealMs` is the median and worst of those per-round figures. Against production, the network legs usually dominate. Comparing two releases fairly means the same network, which is what `ab.sh` gives.
- **Problems:** anything that should never happen, each logged with its minute. The run exits 1 if there were any.
  - a bot gets an error (apart from `VOTING_CLOSED`), or its socket closes outside the restart;
  - a reveal doesn't reach a bot within 5 s, or a browser doesn't show "Votes revealed";
  - a browser shows a connection banner after a reveal, opens a socket it shouldn't, or reports a page error or a Content-Security-Policy violation;
  - a click fails;
  - in runs over 50 minutes, a bot whose laptop "slept" doesn't see all 12 when it wakes.
- **Memory**, at the start, every 5 minutes (10 for production), around the restart and at the end.
- **The restart:** who was back 40 s after it (20 s locally), as the number of people each bot sees.

## Pass conditions for a release

Against production, 30 minutes, with the restart:

- no problems (exit 0), and `late` empty in every round: every reveal reached all 12;
- all 12 back after the restart;
- memory bounded, in line with the last release;
- **0 `rate-limited` lines** in the run's window: `node scripts/soak/check-logs.mjs prod-logs.txt <start> <end>`, with the times the run printed. The same check shows the new process's config line (the limits it runs with), that `/health` writes no lines, and its counts lines.

Reveal times are reported, not a pass condition: they include the network. If they move against the last release, `ab.sh` settles whether the code did.
