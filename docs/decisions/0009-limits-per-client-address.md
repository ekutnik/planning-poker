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

  | Limit                           | Default                                    | Over it                                                         | Why                                                                                                |
  | ------------------------------- | ------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
  | WebSocket upgrades              | `CONNECTS_PER_IP_PER_MINUTE` = 60 a minute | accepted, then closed with 1013 before the room service sees it | two full rooms reconnecting at once from one office                                                |
  | Sockets open at once            | `SOCKETS_PER_IP` = 100                     | accepted, then closed with 1013                                 | several teams behind one address; it takes 10 addresses to fill the 1,000 unjoined slots           |
  | Rooms created                   | `ROOMS_PER_IP_PER_HOUR` = 10 an hour       | `RATE_LIMITED`, then 1013; the room is not created              | a team needs one or two; with rooms evicted after 10 minutes empty, filling 200 takes 20 addresses |
  | Room ids from `POST /api/rooms` | the same 60 a minute as upgrades           | 429, with `Retry-After` in seconds                              | the API only makes up an id; a room exists once someone joins it                                   |

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
- **Settings for the per-connection limits.** Nothing legitimate comes near them, so a setting would only be a way to switch them off.

## Consequences

- One client can no longer fill the room table, the unjoined-socket table or the logs on its own, or slow a room by flooding it.
- **This is not a defence against a distributed attack.** One shared-cpu machine can't absorb one, and Fly's proxy is the only layer in front of it. Many addresses together can still fill the server's caps.
- A team behind one address shares one allowance. The numbers are sized for that, and the release gate is the 30-minute simulation of 12 people from one address, restart included, which must log no `rate-limited` line.
- A refused join retries quietly with the long backoff, showing "Connection lost. Reconnecting…", and its notice is cleared once the join works.
