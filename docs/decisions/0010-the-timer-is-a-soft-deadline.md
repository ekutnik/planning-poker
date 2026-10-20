# 0010. The timer is a soft deadline

- Status: Accepted
- Date: 2026-10-20
- Supersedes: [ADR 0008](0008-the-server-holds-the-timer.md), on one point only: what happens when time runs out. The server still holds the timer.

## Context

ADR 0008 made the timer reveal the votes when its time ran out. After the team's second session, on 2026-10-19, they asked for the opposite: "the end of the timer should not reveal the votes. It should act as a nudge to everyone who still hasn't voted." A reveal nobody pressed cuts a discussion short, and the person still thinking is the one who loses: their vote is never counted. What the team wanted from the timer was a prompt to finish, not a decision taken for them.

## Decision

When time runs out, the timer nudges whoever hasn't voted. It never reveals.

- **`timeUp` expires the timer.** At the deadline the room service applies `timeUp` through the reducer, as before. The timer goes to a new state, `expired`, with `remainingMs: 0` and no `endsAt`, and the round goes on. Nothing is revealed, whether or not anyone has voted, and no point is awarded: only a person's Reveal does that.
- **Everyone connected who hasn't voted is nudged,** once, with a `nudged` message carrying `reason: "time"`. It's the same message, banner and sound as a person's nudge (ADR 0007), and the banner says "Time's up. The room is waiting for your vote." Who is nudged follows the same rule as a person's nudge, without a sender (`timeUpNudges`, beside `nudgeRefusal`). Voters and people who are away get none; if everyone has voted, nobody is nudged.
- **Each of those people's nudge cooldown restarts,** so a person's nudge straight after doesn't double it. Until now time's up ended the round, so it cleared every cooldown in the room; now it sets them. The facilitator's own screen counts the timer's nudges as sent, from the deadline it already had, so its Nudge buttons read "Nudged" for the same 30 s, and a button on screen is still a nudge the server will deliver.
- **From `expired`,** Start runs the whole duration again, and +30 s runs the timer for 30 s. Pause and Resume do nothing. A reveal or Start next round returns it to idle, as from any state. Timer may be switched off in the Menu while expired, since it is no longer counting.
- **`revealCause` is gone** from the room and the snapshot: only a person reveals now. The protocol version goes to 4, so a tab opened before the release is told to reload, rather than meet a timer state it doesn't know.

## Alternatives considered

- **Keep the reveal, with a setting to turn it off.** Two behaviours to explain, and the team's feedback was that the reveal is the wrong default, not an occasional wish.
- **Reveal once everyone has voted, nudge otherwise.** A round nobody revealed would still end on its own. The team reveals when the discussion is done, and that isn't always when the last vote arrives.
- **Nudge, then reveal a little later.** A second deadline that nobody set, which brings back the problem with less warning.
- **Expire silently.** The timer's whole value is getting the last votes in. A timer that reaches 0:00 and does nothing would be decoration.

## Consequences

What gets easier: the timer can't end a round nobody chose to end, and the person it's meant for, the one who hasn't voted, is the one it reaches. The reducer loses a path: only one command reveals.

What gets harder: a round can now sit at 0:00 with its votes hidden. That's the point, but it means the facilitator's Reveal is always needed. The timer's nudge shares the person's cooldown, so a person's nudge in the 30 s after time's up is dropped, by design.
