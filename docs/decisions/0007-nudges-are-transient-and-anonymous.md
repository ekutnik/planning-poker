# 0007. Nudges are transient and anonymous

- Status: Accepted
- Date: 2026-09-27

## Context

When the round waits on someone, the facilitator has to say their name on the call, which is exactly the pressure the tool exists to take away. A nudge lets them prompt one person privately instead. The server has to decide what a nudge is: part of the room's state or not, who may send one, who learns about it, and how often it can come.

## Decision

A nudge is a message, not state. The client sends `{ "type": "nudge", "participantId": "<public id>" }`. If the rules allow it, the server sends `{ "type": "nudged" }` to that person's socket and to nobody else. The message carries nothing more: not who sent it, and nothing about them.

- **Transient.** A nudge never enters the room, its snapshots or its version. The one thing kept is when each person was last nudged, in the room service, for the cooldown; the sweep forgets it once the cooldown has passed, and `bookkeeping()` counts it, so the leak test covers it.
- **The rules:** the room is voting; the sender has joined it; the target is someone else in the same room, connected, with no vote; and nobody has nudged them in the last 30 seconds, whoever sent it. A cooldown ends early when its reason does: the person votes or leaves, or the round ends (reveal or reset). Those are the moments the client's "Nudged" button comes back, so the two agree: a Nudge button on screen is always a nudge the server will deliver.
- **A nudge that breaks a rule is dropped** and logged at info with the reason (`SELF`, `HAS_VOTED`, `COOLDOWN` and so on), never with either person's id. The sender gets no error.
- **Anyone can nudge,** as anyone can reveal (ADR 0005). The button appears only in the facilitator view, which is a per-browser view the server does not know about.

## Alternatives considered

- **A nudge in room state** (say, `nudgedAt` on each participant). Every client would learn who was nudged, which is the public prompt the feature is meant to replace; every nudge would become a broadcast and a new version; and it would outlive the moment, surviving a reconnect.
- **Telling the target who nudged them.** It adds pressure and no information: what matters is that the room is waiting.
- **An error to the sender when a nudge is dropped.** The usual cause is a race: the person voted a moment ago, or someone else nudged them first. Nothing went wrong, so nothing should look like a failure. The client hides the button for people who have voted or are away, and disables it for 30 seconds after a nudge, so a dropped nudge is rare.
- **A cooldown per sender.** Two facilitators could then nudge the same person twice in a row. The limit protects the person nudged, so it is per target.
- **Only facilitators may nudge, enforced by the server.** There are no roles (ADR 0005). Adding one for this alone would bring back the identity and hand-over problems that ADR avoided.

## Consequences

What gets easier: nothing to store in the room or project into snapshots, and the anonymity is structural, since the message has no field that could carry a sender. Clients that predate it ignore the unknown message type (#20), so the protocol version does not change.

What we accept:

- A nudge to someone whose socket drops at that moment is lost: there is no queue and no retry. They still show "Not yet", and the facilitator can nudge again once the cooldown has passed.
- A modified client can nudge without the facilitator view. The cooldown bounds that to one nudge per person every 30 seconds, however many people send them. The per-connection message limit (#16), when it lands, counts a nudge like any other message.
- Clearing the banner when the person votes, the round is revealed or reset, or they leave is the client's job, since the server sends nothing when a nudge ends.

What would change this decision: roles (ADR 0005 revisited), or a need for a nudge to survive a reconnect.
