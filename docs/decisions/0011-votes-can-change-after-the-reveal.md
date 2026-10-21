# 0011. Votes can change after the reveal; points settle at the reveal

- Status: Accepted
- Date: 2026-10-21

## Context

Until now a vote was fixed at the reveal: a different card afterwards was refused with `VOTING_CLOSED`, and only Start next round opened voting again. After the team's second session, on 2026-10-19, they asked for "changing the vote after votes are revealed, but if you change to the winning card afterwards, you don't get a point." The case they had in mind: a draw between two cards, and one person far off who, having heard the discussion, wants to move to one of them and settle it. A new round for that loses the result everyone just discussed, and hides the votes again for no reason.

Keep score (2026-10-01) awards a point to everyone on the winning card at each reveal. A vote that can move after the reveal raises the question of what the points follow.

## Decision

`castVote` is accepted after the reveal. The result follows the votes; the points don't.

- **The same command, in either phase,** with the reducer's usual order of checks: unknown participant, not connected, no-op (the same card again), rules, then the effect. After the reveal `castVote` has no rule of its own left: the one it had, `VOTING_CLOSED`, is the one this removes. A card that isn't in the deck never reaches the reducer: the protocol refuses it first (`INVALID_MESSAGE`), as before. Anyone in the room may change their vote, including someone who hadn't voted before the reveal.
- **`clearVote` stays refused after the reveal** (`VOTING_CLOSED`): a revealed room can see a vote change, but never lose one.
- **The result is recalculated from the votes as they are.** It always was computed from the room at each projection (`computeResults`), so a late change can break a draw, and the result sentence and the scale update for everyone.
- **Points are settled at the reveal and never change afterwards.** Nobody gains or loses a point because of a change after it: not the person who changed, and not anyone else, even when the winning card changes. It's the simplest rule that meets "you don't get a point", and it can't flip-flop as votes move.
- **The room keeps each vote as it was at the reveal** (`voteAtReveal` on each participant), set in the reveal's own commit and cleared at Start next round. The snapshot's revealed participant carries `changedAfterReveal`: their vote differs from the one at the reveal. Changing back clears it; a vote from someone who had none at the reveal is marked. Without the mark, a late change would look like the original vote.
- **The protocol version stays at 4.** The snapshot's new field ships in the same release as ADR 0010's bump, so a tab opened before v1.1.0 is told to reload once, for both.

## Alternatives considered

- **A point for whoever is on the winning card after a change.** That's what the team asked not to have, and it invites moving to the winner once the votes are seen.
- **Recalculate everyone's points from the current votes.** People who voted the winner at the reveal would lose a point because someone else moved, and the scores would change back and forth with every move.
- **A "Vote again" round, hidden as before.** It throws away the discussed result for a one-card change, and it's still possible: Start next round, and paste the ticket again, since Start next round clears it.
- **Allow `clearVote` too.** A revealed room that can lose votes makes the result and the people list disagree with what was discussed, for no gain over changing the card.

## Consequences

What gets easier: a draw can be settled in the room that discussed it, and the result on the shared screen is always the result of the votes on it.

What gets harder: the result and the points can now disagree. After a change, the winning card may not be the one that scored, by design. The mark is what keeps that honest: anyone can see which votes moved after the reveal. A reveal is no longer the end of the votes, only of the points.
