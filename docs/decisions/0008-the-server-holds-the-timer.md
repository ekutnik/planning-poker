# 0008. The server holds the timer

- Status: Accepted
- Date: 2026-10-01

## Context

Teams asked for a timer: the facilitator starts it, everyone sees it count down, and when it ends the votes are revealed. It is the only feature that reveals votes without anyone pressing a button, so where the deadline lives, and what may act on it, decides whether a mistake can reveal a round nobody asked to reveal.

## Decision

The server owns the deadline and reveals the votes itself when time runs out.

- **The deadline is room state.** `room.timer` holds a duration (a minute by default, kept across rounds), a state (idle, running, paused) and, while running, `endsAt` in the server's clock; while paused, `remainingMs`. The commands are `timerSetDuration`, `timerStart`, `timerPause`, `timerResume` and `timerAdd` (30 s, never past 10 minutes left), with the reducer's usual order of checks. A timer command that no longer applies (Pause after the deadline, +30 s while idle) is a no-op, not an error: it races the deadline itself.
- **The reveal is the server's own command.** At the deadline the room service applies `timeUp` through the reducer. It reveals by the same function a person's Reveal uses, so points are awarded the same way, and records `revealCause: "timer"`. With no votes at all there is nothing to reveal, and the timer goes back to idle. There is no automatic reveal when everyone has voted.
- **One timer per running room, from an injected scheduler:** `setTimeout` in production, unref'd so it never keeps the process alive, and a fake in tests. The room service keeps it in step on every write of a room: one at the deadline while running, none otherwise. So a pause, a reveal by a person, Start next round and +30 s move or clear it without any path having to remember; eviction and shutdown clear it too.
- **The callback checks everything again before acting:** the room still exists, its timer is still running, `endsAt` is the one it was scheduled for, and the deadline has passed; one that fired early is scheduled again. `timeUp` then checks the timer and the deadline once more in the reducer. A stale callback never reveals a round.
- **Clients count down locally.** The snapshot carries `endsAt` and `remainingMs`, which change only when the timer does, so projection stays deterministic and send-suppression still works. The server's clock reading goes beside each snapshot, as `serverNow`, never inside it; a client moves `endsAt` into its own clock on arrival, so a browser whose clock is off still counts down to the same moment.

## Alternatives considered

- **The facilitator's browser holds the timer and sends Reveal at zero.** The reveal then depends on one laptop: if it sleeps, loses its connection or closes, the round never ends, which is exactly when a timer matters.
- **The sweep checks deadlines.** It already runs every 5 seconds and would need no new timers, but it can fire up to a sweep interval late: a reveal 5 seconds after "0:00" on everyone's screen looks broken.
- **Each client reveals when its own countdown ends.** Many clients would send Reveal at once, from clocks that disagree, and a client showing 0:03 would still see the round revealed under it.
- **A time relative to now in the snapshot** ("84 seconds left"). Every snapshot would differ from the last, which breaks send-suppression and determinism, and the value is stale by the time it arrives.

## Consequences

What gets easier: one clock decides, whatever state anyone's laptop is in, and a reveal by the timer is indistinguishable from a person's in everything but `revealCause`.

What gets harder: the room service has timers again, which it deliberately avoided for timeouts (they all run in the sweep). The cost is contained: at most one per room with a running timer, all written through one function, and counted in `bookkeeping()`, so the tests prove none is left behind after a pause, a reveal, Start next round, eviction or shutdown. The protocol version goes to 3: an older tab would not break, but would show no timer while everyone else watches one.
