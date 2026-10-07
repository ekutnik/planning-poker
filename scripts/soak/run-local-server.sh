#!/bin/sh
# The local target's server: the production build (npm run build:web and
# build:server first), run as production runs it, on PORT 4400 unless the
# arguments say otherwise, and started again whenever it exits, as Fly
# would, until a file named `stop` appears next to the log.
#
#   scripts/soak/run-local-server.sh /tmp/soak/server.log [VAR=value ...]
#
# Extra arguments are environment variables for the server, PROXY=fly say.
cd "$(dirname "$0")/../.." || exit 1
LOG=$1
shift
while [ ! -f "$(dirname "$LOG")/stop" ]; do
  env NODE_ENV=production HOST=127.0.0.1 PORT=4400 NODE_OPTIONS=--max-old-space-size=128 "$@" node dist/server/main.js >> "$LOG" 2>&1
  echo "{\"runner\":\"server exited $?\"}" >> "$LOG"
  sleep 1
done
