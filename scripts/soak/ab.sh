#!/bin/sh
# An A/B of two releases at production's floor, with the network taken out:
# each release's image, built from its tag with the repository's Dockerfile,
# runs in Docker at 1/16 of a CPU and 207 MiB (shared-cpu-1x's baseline and
# a 256 MB machine), one after the other, under the same simulation.
#
#   scripts/soak/ab.sh v0.4.0 v0.5.0
#
# SOAK_MINUTES (default 30) and RESTART_AT (default 16) as for soak.mjs.
# Logs, summaries and the server's own log go to ./ab-<tag>.*.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MINUTES=${SOAK_MINUTES:-30}
RESTART=${RESTART_AT:-16}
for tag in "$@"; do
  git -C "$ROOT" archive "$tag" | docker build -q -t "pp-ab:$tag" - > /dev/null
done
for tag in "$@"; do
  docker rm -f pp-ab > /dev/null 2>&1 || true
  docker run -d --name pp-ab -p 127.0.0.1:4600:3000 --cpus=0.0625 --memory=207m --memory-swap=207m \
    -e PROXY=fly -e NODE_OPTIONS=--max-old-space-size=128 -e MAX_ROOMS=200 "pp-ab:$tag" > /dev/null
  # At 1/16 of a CPU the server takes about 20 s to start.
  until curl -sf http://127.0.0.1:4600/health > /dev/null; do sleep 2; done
  echo "$tag up $(date -u +%FT%TZ)"
  SOAK_LOG="ab-$tag.log" SOAK_MINUTES=$MINUTES RESTART_AT=$RESTART \
    node "$ROOT/scripts/soak/soak.mjs" --target docker > "ab-$tag.out" 2>&1 || echo "$tag: problems, see ab-$tag.out"
  echo "$tag done $(date -u +%FT%TZ)"
  docker logs pp-ab > "ab-$tag.server.log" 2>&1
  docker rm -f pp-ab > /dev/null
done
