# 0004. Vote privacy via projection

- Status: Accepted
- Date: 2026-09-23

## Context

The core rule of planning poker is that votes stay hidden until everyone reveals together. That rule only means something if it is actually enforced — not merely displayed as hidden.

## Decision

The server projects room state per phase and never transmits vote values before reveal. A pre-reveal snapshot says only _who has voted_ (a boolean per participant), never _what_ they voted. Actual card values enter the snapshot only after a reveal has occurred.

## Alternatives considered

- **Send every vote to all clients and hide them in the UI ("client-side hide").** This is not privacy, it is a leak. The values would sit in the browser — visible in the network tab, devtools, or memory — so any curious participant could read others' votes before reveal. It fails the one guarantee the product makes.
- **Client-side encryption of votes.** Real privacy, but it forces key exchange and coordination for a problem the server can solve by simply not sending the data.

## Consequences

What gets easier: privacy becomes a property of what leaves the server, so it cannot be bypassed from a client. The security boundary is unambiguous — it lives on the server.

What gets harder: the server must own phase state and maintain two snapshot shapes (pre- and post-reveal), and clients must render both. That extra branching is a small, worthwhile price for a guarantee we can actually stand behind.
