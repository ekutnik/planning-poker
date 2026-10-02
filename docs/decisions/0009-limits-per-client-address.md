# 0009. Limits per client address, sized for a team behind one NAT

- Status: Accepted
- Date: 2026-10-02

## Context

Before the link goes beyond one team (#16, #66), one client, buggy or hostile, must not be able to degrade a room for everyone else, fill the server's shared caps (200 rooms, 1,000 sockets not yet joined) on its own, flood the logs, or exhaust memory with one message.

The constraint that sets every number: a whole team sits behind one office address. Twelve to thirty people share one IP, all join at about the same moment, and all reconnect at once after a restart. A limit that bites them is a bug.

Per-connection limits (#16, parts 1 and 3) are not enough on their own: a connection is free to make, so anything a client can do once per connection, it can do as often as it opens connections.

## Decision

The server limits what each client address can do, as token buckets: a capacity, refilled evenly over a window, so one number is both the burst and the steady rate. Every limit is a pure object with the clock passed in.

- **The key** is `limitKey(clientIp(request, proxy))`: the client's address as `Fly-Client-IP` reports it behind Fly, and the socket's address anywhere else, so a client can never choose its own key.
  - An IPv4-mapped IPv6 address is the IPv4 address it is.
  - **IPv6 is keyed on its /64.** One household or one phone network usually holds a whole /64, so keying on the full address would make every limit free to get around.
  - Anything that isn't an address shares one strict key, `"invalid"`.
  - A key is an address, so it is never logged. A limit's log line names its connection id, and the request's own log line already has the address.
- **Per address, with configurable defaults that are production's values** (fly.toml sets none of them):

  | Limit                                      | Default                                                                             | Over it                                                                                          | Why                                                                                                                                                                   |
  | ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | WebSocket upgrades                         | `CONNECTS_PER_IP_PER_MINUTE` = 60 a minute                                          | accepted, then closed with 1013 before the room service sees it                                  | two full rooms reconnecting at once from one office                                                                                                                   |
  | Sockets open at once                       | `SOCKETS_PER_IP` = 100                                                              | accepted, then closed with 1013                                                                  | several teams behind one address; it takes 10 addresses to fill the 1,000 unjoined slots                                                                              |
  | Rooms created                              | `ROOMS_PER_IP_PER_HOUR` = 10 an hour                                                | `RATE_LIMITED`, then 1013; the room is not created                                               | a team needs one or two; with rooms evicted after 10 minutes empty, filling 200 takes 20 addresses                                                                    |
  | Room ids from `POST /api/rooms`            | the same 60 a minute as upgrades                                                    | 429, with `Retry-After` in seconds                                                               | the API only makes up an id; a room exists once someone joins it                                                                                                      |
  | Commands, across all the address's sockets | `COMMANDS_PER_IP_PER_SECOND` = 10 a second, after a burst of `SOCKETS_PER_IP` (100) | not applied; `RATE_LIMITED` at most once a second, and a strike, as for the per-connection limit | each command can send a snapshot to everyone in a room; the burst is one command per socket an address may hold, so several teams behind one NAT can all vote at once |

- **Commands are counted per address too,** across all its sockets, the same way the per-connection limit counts them: malformed messages included, joins and pings not. A command its own connection's limit refused is not charged to the address as well. Without this, one address within every other limit could hold 100 sockets at 4.9 commands a second each, about 490 commands and 13,650 snapshots a second, which measured 67–79% of a core locally: far past what the production machine sustains (see Consequences).
- **Rooms are counted where they are created:** when a join names an unknown id and the room enters the map. Joining a room that exists never counts, so a teammate is never blocked by rooms someone else on the office network made.
- **Over a limit at the upgrade:** accept it, then close with 1013, the same pattern as `OUTDATED_CLIENT` and for the same reason (#17): a browser can't read the HTTP status of a failed upgrade, and the client already retries 1013 with its long backoff (5 s doubling to 2 minutes, spread at random). The upgrade rate is checked first, for every attempt, outdated clients included; then the version; then the open sockets.
- **The open-socket count can never leak.** A missed decrement would lock an office out until the process restarts. So it changes in exactly two places: one more just before the room service gets the socket, and one fewer in that socket's own `close` event, which ws fires exactly once, whatever closed it.
- **Bounded memory:** each table holds at most 10,000 keys. A bucket that has refilled, for a key with no sockets open, remembers nothing worth keeping, so the sweep drops it. When a table is still full, a new key is refused (fail closed), with one log line a minute.
- **Per connection** (#16, parts 1 and 3), as constants, since nothing legitimate comes near them:
  - 20 messages, refilled at 5 a second;
  - `RATE_LIMITED` at most once a second;
  - the client's own liveness ping in a bucket of its own (5, refilled one every 5 s), so a command flood never starves a healthy client's ping;
  - 40 strikes, refilled at 4 a second, then close with 1008. Strikes only build while refused messages come faster than 4 a second, which means more than 9 messages a second in all: about 40 s of flooding at 10 a second, 8 s at 14, under half a second at 100. Below 9 a second a client is held to 5 a second and never closed.
- **Log floods are capped for the whole server,** not per connection: at most 10 lines a minute for each kind of line a client can cause, then one line with the count.
- **No protocol change.** The limits reuse what the client already handles: `RATE_LIMITED`, 1008 and 1013.

## Alternatives considered

- **Per-connection limits only.** They bound one socket, and a socket is free: a client opens another.
- **Keying on the full IPv6 address.** Every device on a /64 has many addresses to pick from, so the limit would cost nothing to get around.
- **Fail open when a table is full,** letting a new key through. Filling 10,000 keys takes a distributed attack, which these limits don't claim to stop; failing closed keeps memory bounded whatever happens.
- **Refusing the upgrade with HTTP 429.** The browser can't read the status of a failed upgrade, so the client couldn't tell a limit from a network failure.
- **Lower limits.** A whole team behind one address, reconnecting together after a restart, would meet them.
- **Counting snapshots sent instead of commands** (each command costing the number of people it reaches). More exact, since the cost of a command is its fan-out, but harder to explain and to size. With rooms capped at 30, a command costs at most 30 snapshots, so commands are a close enough measure; worth moving to if the room-size cap ever rises above 30.
- **Settings for the per-connection limits.** Nothing legitimate comes near them, so a setting would only be a way to switch them off.

## Consequences

- One client can no longer fill the room table, the unjoined-socket table or the logs on its own, or slow a room by flooding it.
- **Nothing else stands in front of the server.** Since 2024, Fly's proxy sets no hard connection limit unless the app sets one ([Fly's announcement](https://community.fly.io/t/new-concurrency-hard-limit-default/20107)), and `fly.toml` sets none: these limits are the only bound on what one client can open.
- **Measured at production's floor** (Docker held to 1/16 of a CPU, the shared-cpu-1x baseline once its burst balance is spent, and 207 MiB): one address at every limit, 100 sockets in rooms of 30 sending 9.6 commands a second, used a median 3.7% of a core against the 6.25% available, kept a 12-person room's reveals under 7 ms, and kept memory under 92 MiB. Its sockets never refused, and the room beside it got no `RATE_LIMITED`. Sockets that stop reading are dropped by the heartbeat within 40 s, or at 1 MiB unsent, whichever comes first, so a silent client's buffers stay bounded.
- **A dozen addresses together can still saturate it.** Eleven addresses sending into one room of 30, about 1,470 snapshots a second, stalled the server for about 30 s at 1/16 of a CPU: a 12-person room beside it missed three reveals before the buffer cap dropped the silent sockets and it recovered. Memory stayed under 110 MiB and came back down. That is the distributed attack these limits don't claim to stop.
- **A stalled server judges clients by when it reads them.** Messages read in a burst after a stall look like a burst, so during the 30 s above, senders at 4.9 a second were refused and closed with 1008. A team's normal traffic is nowhere near 20 commands at once, so it isn't touched; a client sending steadily close to the limit can be.
- **Starting at the floor is slow.** At 1/16 of a CPU the process takes about 22 s from start to listening, against the health check's 10 s `grace_period`. With burst balance, as after a deploy, the live machine restarted in about 4 s (old process gone to new one listening, machine restart included).
- **This is not a defence against a distributed attack.** One shared-cpu machine can't absorb one, and Fly's proxy is the only layer in front of it. Many addresses together can still fill the server's caps.
- **People behind the same NAT share the address's allowances,** commands included, so one person flooding from an office slows their own colleagues. That is inherent to limits per address, and acceptable here because the office is the team itself.
- A team behind one address shares one allowance. The numbers are sized for that, and the release gate is the 30-minute simulation of 12 people from one address, restart included, which must log no `rate-limited` line.
- A refused join retries quietly with the long backoff, showing "Connection lost. Reconnecting…", and its notice is cleared once the join works.
