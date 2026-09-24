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

## Architecture

### Presence and timeouts

Every timeout runs in one periodic sweep that compares timestamps (no per-connection timers), so each deadline fires up to one sweep interval (5s) late.

| Rule              | Threshold               | In practice                    |
| ----------------- | ----------------------- | ------------------------------ |
| Join timeout      | 10s without `join`      | closed after 10–15s            |
| Heartbeat ping    | every 15s               | answered by the browser itself |
| Heartbeat timeout | 35s since the last pong | terminated after 35–40s        |
| Disconnect grace  | 60s after disconnecting | removed after 60–65s           |

**Worst case:** a laptop whose lid closes (no FIN is ever sent) shows as disconnected 35–40s after its last pong and leaves the room at most **105s** after it (35s + 60s + two sweep intervals). Reconnecting before then reclaims the seat with the vote. A test asserts this bound.

If the server itself pauses for longer than two sweep intervals, the next sweep enforces no deadline, so clients are not blamed for the server's own stall.

## Design decisions

See [docs/decisions](docs/decisions).

## Roadmap

## License

MIT
