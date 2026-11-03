# 0012. Points outlast a seat for 4 hours

- Status: Accepted
- Date: 2026-11-02

## Context

Since Keep score (2026-10-01), someone removed from a room lost their points: at Leave the room, and when the grace period ended, 60 s after their connection dropped. Someone back within 60 s kept them, and a person back after that, in the same browser, started at 0.

In the team's session of 2026-11-02 the facilitator's points went to 0 partway through. The logs can't say whose connection was whose, since they hold no names, but they show why it can happen to anyone: 19 removals in that one room, some after a single short drop, others from a device whose connection kept failing. Most connections stayed up throughout. Nothing was wrong with the server: the rule was.

A person coming back is recognised by their browser: the participant id comes from a session token kept in it, so it survives a dropped connection and a new network address.

## Decision

The seat keeps its rule, and the points outlast it by 4 hours.

- **The seat is unchanged:** 60 s, then removal. Leave the room is immediate.
- **On removal or Leave the room,** the person's points stay in the room (`keptPoints`), with the time they left. They're out of `scores`.
- **The same browser back within 4 hours gets them back,** in the same change as the join, by the clock rather than by whether the sweep has been round. At 4 hours or later it starts at 0.
- **Why 4 hours:** a session runs 90–120 minutes; 4 hours covers someone who drops at the start and returns at the end, with margin for an overrun.
- **After 4 hours the sweep forgets them,** through a server-only command, `forgetPoints`, so the rule stays in the reducer. No viewer can see them, so it's no change to the room: the version stays, and nothing is sent. The sweep leaves an empty room alone, since writing it would restart its 10 minutes.
- **They go with the room.** An empty room still closes after 10 minutes, so the team's next session, a fortnight later on the same link, starts at 0 for everyone.
- **Never in a snapshot.** Points of someone who has left aren't sent, and nor is the fact that they exist. So no protocol change.
- **Bounded:** 100 at most per room, dropping the oldest, and counted in `bookkeeping()`, so the leak test sees them.

## Alternatives considered

**Keep the seat for 4 hours,** by changing the 60 s to 4 hours. It's a one-line change that fixes the reconnect, but that timer controls the seat, not just the points:

| Side effect                        | What you'd see                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| People who left stay on the list   | Shown as Away for 4 hours, and named in the status line every round: "Waiting for Cy. Fay is away." |
| Empty rooms stay alive             | About 4 hours instead of 10 minutes, each holding one of the 200 room slots on a public app         |
| Away seats still count             | They use up the 30-person limit, so people could be refused with "room full"                        |
| Leave the room still erases points | It doesn't go through that timer                                                                    |

**Keep points for the whole life of the room, with no limit.** It's simpler, but a room stays alive as long as anyone is in it, so a tab left open could carry someone's old points into a later session.

**Match a returning person by name,** so points follow them to another browser or device. Anyone typing the same name would get those points. Nothing in the session's logs called for it. Reopen this if switching devices turns out to matter.

**Carry points from one session to the next.** Rooms live only in memory (ADR 0001), and Keep score is for the session.

## Consequences

What gets easier: a dropped connection, a sleeping laptop or a mistaken Leave the room no longer costs anyone their points.

What gets harder: the room holds state for people who aren't in it, so it needs its own limit, sweep and leak check. A different browser or device is still a new person, and starts at 0.

Note (2026-11-02): a room stays open while any tab in it keeps reconnecting, as tabs on sleeping devices did after that day's session. Everyone still in the room keeps their points, so a session on the same link could inherit them. The 4-hour limit covers only people who have left.
