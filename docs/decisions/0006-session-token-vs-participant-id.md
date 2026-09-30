# 0006. Session token vs. public participant id

- Status: Accepted
- Date: 2026-09-24

## Context

Participants reclaim their seat after a refresh or reconnect by presenting an identifier they persist in `localStorage` (seat reclaim, 0001). But snapshots broadcast **every** participant's id to everyone in the room (0003, 0004). If the identifier a client presents on `join` is the same value that appears in snapshots, then the thing that authenticates a socket is also a public field — a contradiction. The attack is trivial:

1. Read Bob's id from any snapshot.
2. Open a socket.
3. Send `join` with Bob's id.

You now hold Bob's seat and can vote as him. The original rule — the server stamps identity from the socket and never trusts a client's claim — is correct, but it only holds if the value that authenticates a socket cannot simply be copied out of a public field. As originally specified, it could. This ADR owns and fixes that flaw before it is built.

## Decision

Separate the secret from the public id.

|                     | `sessionToken`                                               | `participantId`                                                             |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Created by          | The client — `crypto.randomUUID()`, stored in `localStorage` | The server — `base64url(sha256(roomId + ":" + token))`, first 16 characters |
| Sent                | Only in the `join` message, client → server                  | In snapshots, to everyone                                                   |
| Knowing it lets you | Act as that participant                                      | Nothing                                                                     |

The transport hashes the token at `join` and hands the derived `participantId` to the domain. The domain never sees tokens, so it cannot leak a secret it never receives — and nothing about the domain changes.

**Why a plain SHA-256, and why 16 characters.** Slow hashes (bcrypt, Argon2) exist to protect _low-entropy_ secrets such as passwords from brute force. A `crypto.randomUUID()` token carries 122 random bits, so it cannot be brute-forced at all, and key stretching would add cost with no added protection — a single fast hash is exactly right here. Truncating the digest to 16 base64url characters keeps 96 bits of the public id; with at most `MAX_PARTICIPANTS = 30` ids in a room, the collision probability is effectively zero, so 16 is a deliberate budget, not a guess.

## Alternatives considered

- **A server-issued token** (the server generates the secret and returns it on first join). Stronger, because the client can't pick a weak token — but it costs an extra round-trip on first join, and a weak _client-chosen_ token only harms the client that chose it, never the room. Not worth the round-trip for v1.
- **A `token → id` map held in the transport.** Works, but adds a second data structure that must stay in sync with the participants map across `leave`, TTL eviction, and restarts. Deriving the id by hash is stateless and needs no such bookkeeping.
- **Keep sending the raw persisted id (the original design).** Rejected outright: it _is_ the vulnerability above — the authenticator is broadcast to everyone.

## Consequences

What gets easier: the public id is safe to broadcast because it is a one-way hash of the secret — it cannot be reversed into the token. Derivation is **stateless**: after a restart with recreate-on-join (0001), the same token deterministically reproduces the same `participantId` with zero bookkeeping. Salting the hash with `roomId` means the same person in two different rooms gets unlinkable ids, so presence cannot be correlated across rooms.

What we accept: the token is a bearer secret in `localStorage` — anyone who holds it (or has access to that browser) can act as that participant. That is the correct trade for a low-stakes estimation tool with no roles (0005). Because the client chooses the token, a client that picks a weak one exposes only itself. If we ever need stronger guarantees, the upgrade path is the server-issued token noted above, and it does not touch the domain.

**Multiple tabs — one token, many sockets.** `localStorage` is shared across a browser's tabs, so the same person with two tabs open has one token and one `participantId`, but two sockets. If closing either tab dispatched `disconnect`, it would mark the participant offline while the other tab is still live — a presence bug. We resolve it with **latest socket wins**: a new `join` bearing a token that already has a live socket closes the older socket with a specific close code, and the superseded tab shows "Opened in another tab". This is simple, familiar (WhatsApp Web behaves this way), and keeps "one socket per participant" an invariant. The rejected alternatives are `sessionStorage` (each tab becomes a separate seat, which loses seat reclaim after an accidental tab close — the whole point of the token) and socket reference-counting (more state, and two tabs voting as one person is confusing). This creates a race for the transport to handle: closing a _superseded_ socket must **not** dispatch `disconnect`, because the participant is still connected through the newer socket. That gets a test when the transport exists.
