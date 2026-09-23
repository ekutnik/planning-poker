# 0005. Anyone can reveal

- Status: Accepted
- Date: 2026-09-23

## Context

Someone has to trigger the reveal (and reset for the next story). We must decide whether that action is restricted to a privileged participant — a host or moderator — or available to everyone in the room.

## Decision

In v1 there are no roles. Any participant in a room can reveal, and any participant can reset. There is no host, owner, or moderator concept.

## Alternatives considered

- **Host-only reveal** (the room creator or first joiner is moderator). This requires a notion of identity, plus a rule for what happens when the host disconnects mid-session — host handoff, re-election, or a stuck room. That is a meaningful amount of state and edge-case handling.
- **Explicit role assignment UI.** Even more machinery, aimed at a governance problem a single scrum team does not have.

## Consequences

What gets easier: no authentication, no roles, and no "the host left" failure mode. It matches how a small, trusted team actually behaves — someone simply says "flip them" and does it. Less code, fewer states, fewer bugs.

What gets harder: there is no safeguard against a premature or accidental reveal; the design leans on social trust within the room.

What would change this decision: larger rooms, untrusted or public sessions, or observed abuse. Any of those would justify introducing a host role and permissioned actions. For a trusted team in v1, trust is the correct and cheapest default.
