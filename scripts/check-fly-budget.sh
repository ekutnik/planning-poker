#!/bin/sh
# The app's budget on Fly (README, Deploy): one shared-cpu-1x machine with
# 256 MB, no dedicated IPv4, and no volume (billed even while its machine
# is stopped). Fly has no spending cap and no billing
# alert, so this is the alert: run after every deploy and once a week, it
# fails when the app has drifted from that, and GitHub emails the failure.
# Needs flyctl, jq, and FLY_API_TOKEN (or a flyctl login).
set -eu
app=$(sed -n 's/^app = "\(.*\)"$/\1/p' fly.toml)
machines=$(flyctl machine list --app "$app" --json)
count=$(printf '%s' "$machines" | jq length)
sizes=$(printf '%s' "$machines" | jq -r '[.[] | "\(.config.guest.cpu_kind)-\(.config.guest.cpus)x-\(.config.guest.memory_mb)mb"] | unique | join(",")')
dedicated=$(flyctl ips list --app "$app" --json | jq '[.[] | select(.Type == "v4")] | length')
volumes=$(flyctl volumes list --app "$app" --json | jq length)
echo "$app: $count machine(s), $sizes; dedicated IPv4: $dedicated; volumes: $volumes"
fail=0
if [ "$count" -ne 1 ]; then
  echo "::error::$count machines: the budget is one"
  fail=1
fi
if [ "$sizes" != "shared-1x-256mb" ]; then
  echo "::error::machine size $sizes: the budget is shared-1x-256mb"
  fail=1
fi
if [ "$dedicated" -ne 0 ]; then
  echo "::error::a dedicated IPv4 costs \$2 a month: the shared one is free"
  fail=1
fi
if [ "$volumes" -ne 0 ]; then
  echo "::error::$volumes volume(s): billed even while the machine is stopped"
  fail=1
fi
exit $fail
