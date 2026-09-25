# Planning Poker

Real-time scrum estimation for distributed teams. Votes stay hidden until reveal; the result shows consensus, spread and outliers.

> Status: in development towards v1.

## Why this exists

## Features

## Running locally

## Development

Requires Node 24 (see `.nvmrc`).

```bash
npm install     # also installs the git hooks
npm run dev     # server on http://localhost:3000, restarts on change
npm run check   # typecheck, lint, format check and tests, as CI runs them
```

`npm install` points git at [`.githooks/`](.githooks). Its `pre-push` hook runs `npm run check`, so a push that would fail CI fails locally first. Commits are not gated, so work-in-progress commits stay cheap, and CI remains the real gate. Skip the hook once with `git push --no-verify`.

### Configuration

The server reads its settings from environment variables. Unset means the default. A set but invalid value, including an empty string, stops it from starting, with a message that names every bad variable.

| Variable            | Default  | Meaning                                                                                              |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`              | `3000`   | HTTP and WebSocket port                                                                              |
| `LOG_LEVEL`         | `info`   | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                       |
| `MAX_ROOMS`         | `10000`  | Rooms held in memory; a join that would create one more is refused                                   |
| `MAX_PENDING`       | `1000`   | Sockets that have not joined yet; more are refused with `1013`                                       |
| `SWEEP_INTERVAL_MS` | `5000`   | How often timeouts are checked (100–6333; the ceiling is `MAX_SWEEP_INTERVAL_MS`, see Server stalls) |
| `ROOM_TTL_MS`       | `600000` | How long a room may stay empty before it is evicted                                                  |

## Architecture

### Presence and timeouts

Every timeout runs in one periodic sweep that compares timestamps (no per-connection timers), so each deadline fires up to one sweep interval (5s) late.

| Rule              | Threshold               | In practice                    |
| ----------------- | ----------------------- | ------------------------------ |
| Join timeout      | 10s without `join`      | closed after 10–15s            |
| Heartbeat ping    | every 15s               | answered by the browser itself |
| Heartbeat timeout | 35s since the last pong | terminated after 35–40s        |
| Disconnect grace  | 60s after disconnecting | removed after 60–65s           |
| Room TTL          | 10 min empty            | evicted after 10 min–10 min 5s |

**Worst case:** a laptop whose lid closes (no FIN is ever sent) shows as disconnected 35–40s after its last pong and, absent a server stall, leaves the room at most **105s** after it (35s + 60s + two sweep intervals). Reconnecting before then reclaims the seat with the vote. A test asserts this bound.

**Server stalls.** If the server itself pauses for longer than two sweep intervals (10s), the next sweep enforces no deadline, so clients are not blamed for the server's own stall; every deadline moves back by one interval. A shorter stall goes undetected but delays pongs by at most two intervals. A healthy connection is safe as long as `PING_INTERVAL_MS + 3 × interval + RTT_MARGIN_MS < PONG_TIMEOUT_MS` (a ping can go out one interval late, its pong needs a round trip, and an undetected stall adds up to two intervals). `MAX_SWEEP_INTERVAL_MS` in `src/server/room-service.ts` is the largest interval that satisfies it (6,333 ms with the current constants), configuration rejects anything above it, and a test fails if the constants ever stop satisfying it. The heartbeat therefore either detects a stall or absorbs it.

## Design decisions

See [docs/decisions](docs/decisions).

## Roadmap

## License

MIT
