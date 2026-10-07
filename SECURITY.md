# Security

## Reporting a vulnerability

Please report it privately, through GitHub's private vulnerability reporting: **Report a vulnerability** on this repository's Security tab. Please don't open a public issue for it.

Say what you found, how to reproduce it, and what it lets someone do.

I aim to acknowledge reports within 7 days. This is a one-person project, so there's no guaranteed response time.

## Supported versions

The latest release only: it is what runs at https://estimate-together.fly.dev.

## Out of scope

- **Distributed denial of service.** The limits per client address stop one client from flooding a room, the server or its logs, but one small machine can't absorb a distributed attack ([ADR 0009](docs/decisions/0009-limits-per-client-address.md)).
- **Safari's console message about a refused stylesheet** ([#71](https://github.com/ekutnik/planning-poker/issues/71)): it doesn't come from anything the app serves.
