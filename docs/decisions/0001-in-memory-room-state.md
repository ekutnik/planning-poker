# 0001. In-memory room state

- Status: Accepted
- Date: 2026-09-23

## Context

A planning-poker room is short-lived: a team joins, votes on a handful of stories, and leaves. The server must track each room's participants, their votes, and the reveal phase. We need to decide where that state lives — in the process, or in an external store.

## Decision

Room state lives entirely in memory in the Node process, held in plain `Map`s keyed by room id. There is no database and no external cache for room state.

## Alternatives considered

- **A database (Postgres) or Redis for room state.** Adds schema, migrations, a network hop, and operational surface for data that is worthless minutes after it is created.
- **Redis as a shared store** to enable multiple instances. Solves a scaling problem we do not have yet, at the cost of real complexity now.

## Consequences

What gets easier: the simplest possible model, lowest latency, no persistence layer to build, test, or run.

What gets harder, and the failure modes we knowingly accept:

- **A restart loses all rooms.** A deploy or crash drops every active session. Because sessions are ephemeral and last minutes, participants simply rejoin and re-vote. Acceptable for v1.
- **A single instance only.** State in one process means we cannot run replicas or scale horizontally; capacity is bounded by one machine. If we outgrow it, the path is sticky sessions plus a shared store — deferred until real load demands it.
