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

## Design decisions

See [docs/decisions](docs/decisions).

## Roadmap

## License

MIT
