# 0004. Vote privacy via per-viewer projection

- Status: Accepted
- Date: 2026-09-23

## Context

The core rule of planning poker is that votes stay hidden until everyone reveals together. That rule only means something if it is actually enforced — not merely displayed as hidden. But there is a wrinkle: you must be able to see _your own_ vote before reveal. If you refresh the page or reconnect mid-round, your selected card has to come back, or seat reclaim (0001) silently loses it. So the pre-reveal snapshot cannot be identical for everyone.

## Decision

The server projects room state **per viewer**, not merely per phase, and never transmits another participant's vote value before reveal. Concretely:

- **Before reveal:** each viewer's snapshot contains **their own** vote value, plus only a `hasVoted` boolean for every other participant. No one else's card value is on the wire.
- **After reveal:** every snapshot contains all vote values.

These remain full snapshots per 0003 — we are choosing _what each snapshot contains for its recipient_, not switching to diffs. The pre-reveal broadcast is therefore not one identical payload; the server builds a per-recipient view.

## Alternatives considered

- **Send every vote to all clients and hide them in the UI ("client-side hide").** This is not privacy, it is a leak. The values would sit in every browser — visible in the network tab, devtools, or memory — so any curious participant could read others' votes before reveal. It fails the one guarantee the product makes.
- **Send no votes at all before reveal (per-phase only, not per-viewer).** Enforces privacy, but you can't see your own card, so a refresh loses your selection and seat reclaim can't restore it. Rejected because it breaks a flow we require.
- **Client-side encryption of votes.** Real privacy, but it forces key exchange and coordination for a problem the server can solve by simply choosing what each recipient receives.

## Consequences

What gets easier: privacy becomes a property of what leaves the server _for each recipient_, so it cannot be bypassed from a client — the security boundary is unambiguous and lives on the server. Your own selection always round-trips, so refresh and reconnect restore it for free.

What gets harder: the server must own phase state and build a per-viewer projection rather than broadcasting one shared payload before reveal, and clients must render both the "hidden" and "revealed" shapes. That extra branching is a small, worthwhile price for a guarantee we can actually stand behind — and it is exactly the projection the server implements and covers with a no-leak test.

One residual leak, and its fix: per-viewer projection hides vote _values_, but a naive broadcast still leaks _metadata_. When someone changes their vote before reveal, the room `version` bumps and everyone receives a new snapshot that is identical to the previous one except for `version` — revealing that _somebody_ changed their vote (not what to). The fix belongs in the transport: sends are suppressed for recipients whose projection is unchanged (compare everything except `version`), so a pre-reveal vote change is invisible to others. As a result, `version` is monotonic but **not contiguous** for any given client. Clients must compare snapshots with `>`, never expect `+1`.
