# 0002. Self-hosted WebSockets

- Status: Accepted
- Date: 2026-09-23

## Context

Planning poker is real-time: joins, votes, and reveals must reach every participant instantly and bidirectionally. We need to choose the realtime transport and where it runs.

## Decision

We self-host a WebSocket server using the `ws` library in our own Node process — the same process that holds room state (see 0001). No third-party realtime provider.

## Alternatives considered

- **Hosted realtime services (Pusher, Ably, Supabase Realtime).** Fast to start, but introduce per-message pricing, vendor lock-in, and an external dependency on the hot path. We would still need server logic to enforce vote privacy, so we would pay for a service and keep the hard part.
- **PartyKit / Cloudflare Durable Objects.** Excellent stateful-edge model, but it binds our room state and lifecycle to a specific platform runtime and a new mental model. Heavier commitment than a v1 needs.
- **Socket.IO.** Gives rooms, reconnection, and transport fallbacks, but its custom protocol and abstractions are weight we do not need: we control both client and server, and modern browsers speak WebSocket natively.

## Consequences

What gets easier: total control over the protocol and message shape, no per-message cost, trivial local development, and a natural fit with in-memory single-instance state.

What gets harder: we own the unglamorous parts — reconnection, heartbeats/ping-pong, backpressure, and eventually scaling. We accept that ownership deliberately, because it keeps v1 simple and cheap, and revisit if operational burden grows.
