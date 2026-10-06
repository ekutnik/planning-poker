# Operations

## What the server logs

Every line is one JSON object, written to standard output. On Fly, that's Fly's log store, kept for its own retention period ([Fly's logging overview](https://docs.fly.io/monitoring/logging-overview)). Nothing else keeps them.

### The levels

One rule decides a line's level:

- **info** is a connection's lifecycle, or anything unusual: the config, request lines, opens, joins, leaves, closes, timeouts, evictions, every refusal, the counts.
- **debug** is what people do in a room: every command (a vote, the ticket, the timer, a nudge).

Production runs at `info` (`LOG_LEVEL`), so a team playing normally adds nothing to the log once everyone has joined. A test holds it to that: in a joined room, 100 vote changes add no info line.

### The lines

| Line                       | Level        | When                                                                                                                                 | Fields                                                                       |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Configuration              | info         | startup                                                                                                                              | the effective config, which holds nothing secret                             |
| Startup and shutdown       | info         | listening, serving the client, a signal, shut down                                                                                   | the server's own address and port, the signal                                |
| Request                    | info         | each HTTP request and WebSocket upgrade, except `/health`                                                                            | method, route pattern (never the raw URL), client address                    |
| Request completed          | info         | each HTTP request, except `/health`, room ids and upgrades                                                                           | status, response time                                                        |
| Service events             | info         | `open`, `join`, `leave`, `close`, `supersede`, `join-timeout`, `heartbeat-timeout`, `expire`, `evict`, `outdated-client`, `shutdown` | type, connection id, hashed room; for `outdated-client`, the version it sent |
| Error sent to a client     | info, capped | a refused or invalid command, a full server                                                                                          | code, connection id, hashed room                                             |
| Rate limited               | info, capped | at most once a minute per connection and limit                                                                                       | limit, connection id, how many were refused since its last line              |
| Counts                     | info         | every 5 minutes, even when nothing changed                                                                                           | numbers only (below)                                                         |
| Commands                   | debug        | every message but a join, a leave or a ping                                                                                          | type, connection id, hashed room                                             |
| `nudge-ignored`, `time-up` | debug        | a nudge dropped by its rules, a room's timer running out                                                                             | type, code, connection id, hashed room                                       |
| Slow consumer              | warn, capped | a socket dropped for not reading                                                                                                     | connection id                                                                |
| Limiter full               | warn, capped | a table of client addresses is full                                                                                                  | which limit                                                                  |
| WebSocket error            | warn, capped | a bad frame, such as an oversized one                                                                                                | the error                                                                    |
| `suppressed`               | warn         | once a minute, after a capped line was held back                                                                                     | which line, how many                                                         |
| `sweep-stalled`            | warn         | the sweep ran late                                                                                                                   | how late                                                                     |
| Sweep or shutdown failed   | error        | a bug                                                                                                                                | the error                                                                    |

A capped line goes out at most 10 times a minute across the whole server, a full table once, then one `suppressed` line with a count. `suppressed` counts log lines held back, not messages refused: the messages behind them were refused (or the errors sent) all the same.

### The counts line

```json
{
  "type": "counts",
  "rooms": 1,
  "pending": 0,
  "sockets": 6,
  "participants": 6,
  "timersRunning": 0,
  "roomKeys": 1,
  "commandKeys": 1,
  "slowConsumerDrops": 0,
  "rateLimited": 0,
  "rssMiB": 92,
  "heapUsedMiB": 21,
  "externalMiB": 3
}
```

- `rooms`, `pending` (sockets not joined yet), `sockets` (joined), `participants` (including the disconnected ones a room still holds), `timersRunning`, and the keys the room and command limits hold: what the server holds now.
- `slowConsumerDrops` and `rateLimited` (every refusal: messages, joins, upgrades and room ids): since the last counts line, not since the start.
- `rssMiB`, `heapUsedMiB`, `externalMiB`: the process's memory.

It is written even when nothing changed, so a missing line means the sweep or the process has stopped. Every field but `type` is a number, and a test holds it to that, so no id or name can reach it.

### What never appears in the log

- names, votes, ticket text or durations;
- session tokens: a join frame carries one, so no frame is ever logged, only its type;
- room ids: only a hash of each (`roomLogId`);
- client addresses, except in request lines;
- the contents of any message.

## The Budget workflow, once the repository is public

The Budget workflow (`.github/workflows/budget.yml`) checks every Monday that the app is still what the budget pays for (see the README's budget paragraph). GitHub disables scheduled workflows in a public repository after 60 days without repository activity ([GitHub's docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). The repository is private today, so this applies once it goes public. When it does, the workflow goes silent: no failed run and no failure email, just no run, so a change to the app made from a laptop would go unnoticed. GitHub's docs don't say what counts as activity; a commit to `develop`, the default branch, is the safe assumption. To turn it back on: Actions, then Budget, then Enable workflow (or `gh workflow enable budget.yml`), then run it once by hand.
