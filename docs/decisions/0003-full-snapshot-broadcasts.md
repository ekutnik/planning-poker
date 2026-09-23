# 0003. Full snapshot broadcasts

- Status: Accepted
- Date: 2026-09-23

## Context

Whenever a room changes — someone joins or leaves, casts or changes a vote, or triggers a reveal — connected clients must update. We can either send the full room state each time or send incremental diffs describing only what changed.

## Decision

On every change, the server broadcasts a complete (projected) room snapshot to all clients. Clients replace their local state wholesale. We do not send diffs.

## Alternatives considered

- **Diffs / patches.** Send only the delta (e.g. "participant X voted"). Saves bytes, but each client must apply patches in order and reconstruct state, which invites divergence bugs: a dropped, duplicated, or reordered patch leaves a client silently wrong, and reveal is exactly the moment where "silently wrong" is unacceptable.
- **Event deltas with client reducers.** Same class of problem, more machinery.

## Consequences

What gets easier: correctness is trivial. There is one source of truth — the server — and every broadcast overwrites the client entirely, so clients cannot drift. There is no merge logic, no patch ordering, and reconnection is just "here is the current snapshot."

What gets harder: each message carries the whole room rather than a delta. This is a non-issue at our scale: a room is one scrum team (roughly 3–15 people), so a snapshot is a few hundred bytes. Snapshots are correct by construction; diffs would be a premature optimization bought with real complexity. If rooms ever became large, we would reconsider.
