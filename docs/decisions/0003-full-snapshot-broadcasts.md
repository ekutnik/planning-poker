# 0003. Full snapshot broadcasts

- Status: Accepted
- Date: 2026-09-23

## Context

Whenever a room changes — someone joins or leaves, casts or changes a vote, or triggers a reveal — connected clients must update. We can either send the full room state each time or send incremental diffs describing only what changed. The choice has to hold up across reconnects, which in a real-time app are routine, not rare.

## Decision

On every change, the server broadcasts a complete room snapshot (projected per viewer — see 0004) to all clients. Clients replace their local state wholesale. We do not send diffs. Every snapshot carries a `version` that increases within one room's lifetime, but it is only comparable within one connection: after a server restart, recreate-on-join starts the room again at version 1, so a client comparing across connections would discard every new snapshot as stale and freeze. The protection against stale data across reconnects is simpler: a client ignores every event from a socket that is no longer its current one. Within one connection, where TCP already guarantees order, a decreasing `version` is a server bug worth logging.

## Alternatives considered

- **Diffs / patches.** Send only the delta (e.g. "participant X voted"). Saves bytes, but each client must apply patches to the correct base state and never miss one. The failure mode isn't in-order corruption — a single WebSocket runs over TCP, so within a live connection messages are neither reordered nor duplicated. The real risk is the **reconnect gap**: a client drops for a second, misses the patches sent while it was away, reconnects, and then applies later patches on top of a now-stale base. The result is a client that is silently wrong — and reveal is exactly the moment where "silently wrong" is unacceptable.
- **Event deltas with client reducers.** Same class of problem, more machinery.

## Consequences

What gets easier: correctness is trivial. There is one source of truth — the server — and every broadcast overwrites the client entirely, so clients cannot drift. There is no merge logic and no patch-ordering. Reconnection is just "here is the current snapshot": a stale snapshot racing a fresh one after reconnect arrives on a socket that is no longer current, and is dropped for that reason, not by comparing versions.

What gets harder: each message carries the whole room rather than a delta. This is a non-issue at our scale. A room is one scrum team, and even at our hard cap of `MAX_PARTICIPANTS = 30` a snapshot is low single-digit kilobytes — a rounding error on any modern connection, sent only when something actually changes. Snapshots are correct by construction; diffs would be a premature optimization bought with real complexity. If rooms ever became far larger, we would reconsider.
