# 0001. In-memory room state

- Status: Accepted
- Date: 2026-09-23

## Context

A planning-poker room is short-lived: a team joins, votes on a handful of stories, and leaves. The server must track each room's participants, their votes, and the reveal phase. We need to decide where that state lives — in the process, or in an external store — and to be honest about the two questions "in-memory" always raises: what happens on restart, and what stops memory from growing forever.

## Decision

Room state lives entirely in memory in the Node process, held in plain `Map`s keyed by room id. There is no database and no external cache for room state.

Two policies make that choice safe rather than hand-wavy:

- **Recreate on join.** After a restart (or for any room the server doesn't currently hold), a `join` carrying a **well-formed** room id recreates that room, empty, and the client reconnects into it. Room ids are validated against a strict format — exact length and a fixed alphabet — so only ids our own generator could have produced are accepted; anything else is rejected outright rather than materialising a room. A well-formed id the server has never seen (a typo, say) creates an empty room, which the sweep below reclaims.
- **Bounded memory.** The process holds at most `MAX_ROOMS` rooms, and a periodic TTL sweep evicts rooms that are empty or idle past a timeout. Together these cap memory regardless of traffic or abandoned links.

## Alternatives considered

- **A database (Postgres) or Redis for room state.** Adds schema, migrations, a network hop, and operational surface for data that is worthless minutes after it is created.
- **Redis as a shared store** to enable multiple instances. Solves a scaling problem we do not have yet, at the cost of real complexity now.
- **"Room not found" on restart** (make the user create and re-share a new room). Honest, but it breaks a team's flow mid-sprint-planning for no benefit; recreate-on-join keeps the already-shared Slack link working, losing only the in-flight votes.

## Consequences

What gets easier: the simplest possible model, lowest latency, no persistence layer to build, test, or run. Recreate-on-join means a deploy or crash is nearly invisible — participants' clients reconnect into the same room id and simply re-vote the current story.

What gets harder, and the failure modes we knowingly accept:

- **A restart loses in-flight votes.** Only the current round's selections are lost, not the session; the room id survives via recreate-on-join. Acceptable for v1.
- **A single instance only.** State in one process means we cannot run replicas or scale horizontally; capacity is bounded by one machine and by `MAX_ROOMS`. If we outgrow it, the path is sticky sessions plus a shared store — deferred until real load demands it.
