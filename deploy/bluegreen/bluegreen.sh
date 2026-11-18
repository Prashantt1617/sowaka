#!/bin/bash
# Blue/green deploys of the Sowaka backend on the API server (docs/deploy/bluegreen.md).
# Run as root (SSM's AWS-RunShellScript does):
#
#   bash /home/ubuntu/app/sowaka/deploy/bluegreen/bluegreen.sh status
#   bash .../bluegreen.sh deploy      pull main, build the idle colour, start it, wait until ready,
#                                     point nginx at it, stop the old one
#   bash .../bluegreen.sh rollback    start the other colour again from its untouched build, then the
#                                     same switch (the build before the last deploy)
#   bash .../bluegreen.sh switch PORT only rewrite nginx's upstream and reload (no processes touched)
#   bash .../bluegreen.sh migrate     ONCE, before the first deploy: nginx's upstream becomes the
#                                     include this script rewrites (still :4000, so nothing moves)
#
# Settings (environment): READY_TIMEOUT (s, default 420), MIN_FREE_MB (default 500),
# STRICT_ROOMS=1 (refuse while any poker/pool room is open, as the old deploy did),
# WAIT_FOR_LIVE (s: wait this long for a refusing condition to clear instead of stopping at once),
# FORCE=1 (switch despite the live check: a live Diwali Cup loses its last seconds of scores).
#
# Exit codes: 0 switched (or status), 1 failed before anything changed, 2 refused (live games),
# 3 the new copy never got ready (stopped again; nginx untouched), 4 nginx switch failed (old still serving).
set -uo pipefail

# Run from a copy: `git pull` below may rewrite this very file, and bash reads a script as it goes.
if [ -z "${BLUEGREEN_COPY:-}" ]; then
  COPY=$(mktemp /tmp/bluegreen.XXXXXX.sh)
  cp "$0" "$COPY"
  BLUEGREEN_COPY=1 exec bash "$COPY" "$@"
fi
trap 'rm -f "$0"' EXIT

APP=/home/ubuntu/app/sowaka
BE=$APP/backend
BG=$APP/deploy/bluegreen
UPSTREAM=/etc/nginx/sowaka-upstream.conf
READY_TIMEOUT=${READY_TIMEOUT:-420}
MIN_FREE_MB=${MIN_FREE_MB:-500}

as_ubuntu() { sudo -u ubuntu HOME=/home/ubuntu "$@"; }
pm2q() { as_ubuntu pm2 "$@" 2>&1; }
pm2j() { as_ubuntu pm2 jlist 2>/dev/null; }
say() { echo "[$(date -u +%H:%M:%S)] $*"; }
health() { curl -s -m 3 "http://127.0.0.1:$1/health" 2>/dev/null; }
ready_code() { curl -s -m 5 -o /tmp/bluegreen-ready.json -w '%{http_code}' "http://127.0.0.1:$1/health/ready" 2>/dev/null; }

colour_of() { case "$1" in 4000) echo blue;; 4001) echo green;; *) echo "";; esac; }
port_of() { case "$1" in blue) echo 4000;; green) echo 4001;; esac; }
other() { case "$1" in blue) echo green;; green) echo blue;; esac; }

active_port() { grep -oE '127\.0\.0\.1:[0-9]+' "$UPSTREAM" 2>/dev/null | head -1 | cut -d: -f2; }

# Point nginx at PORT: write the one-line include, check the whole config, reload gracefully.
# On a failed check the previous file goes back and nginx is not reloaded.
switch_to() {
  local port=$1 before
  before=$(mktemp)
  cp "$UPSTREAM" "$before"
  printf '# Written by deploy/bluegreen/bluegreen.sh at %s. 4000 = blue, 4001 = green.\nserver 127.0.0.1:%s;\n' "$(date -u +%FT%TZ)" "$port" > "$UPSTREAM.new"
  mv "$UPSTREAM.new" "$UPSTREAM"
  if ! nginx -t -q 2>/tmp/bluegreen-nginx-t.log; then
    cp "$before" "$UPSTREAM"; rm -f "$before"
    say "nginx -t FAILED, upstream file restored, nothing reloaded:"; cat /tmp/bluegreen-nginx-t.log
    return 1
  fi
  rm -f "$before"
  # A graceful reload: new workers take new connections on the new upstream; old workers finish
  # the requests they have (and keep their open sockets until the old process closes them).
  nginx -s reload || { say "nginx reload FAILED"; return 1; }
  # Through nginx, the new copy answers within a moment (old workers may answer a request or two).
  for _ in $(seq 1 20); do
    sleep 0.5
    if curl -s -m 3 http://127.0.0.1/health | grep -q "\"port\":$port"; then say "nginx now sends traffic to :$port"; return 0; fi
  done
  say "nginx reloaded but /health through it does not show :$port yet"; return 1
}

status() {
  local port; port=$(active_port)
  say "nginx upstream: :${port:-?} ($(colour_of "${port:-0}"))"
  for c in blue green; do
    local p; p=$(port_of $c)
    echo "  $c :$p  pm2=$(pm2j | python3 -c "import json,sys
try:
  d=[x for x in json.load(sys.stdin) if x['name']=='sowaka-$c']
  print(d[0]['pm2_env']['status']+' rss=%dMB'%(d[0]['monit']['memory']/1048576) if d else 'absent')
except Exception: print('?')")  health=$(health $p | head -c 220)"
  done
  echo "  free: $(awk '/MemAvailable/ {printf "%d MB available", $2/1024}' /proc/meminfo)"
}

# Start COLOUR from its build, wait until it is ready, switch nginx to it, stop the other.
cutover() {
  local NEW=$1 OLD NEW_PORT OLD_PORT t0 code free
  OLD=$(other "$NEW"); NEW_PORT=$(port_of "$NEW"); OLD_PORT=$(port_of "$OLD")
  [ -f "$BE/dist-$NEW/server.js" ] || { say "no build in dist-$NEW"; exit 1; }

  # Live games: refuse (or wait) where a switch would lose something.
  local live_args=(--env "$BE/.env"); [ "${STRICT_ROOMS:-0}" = 1 ] && live_args+=(--strict)
  local waited=0
  while true; do
    LIVE=$(cd "$BE" && as_ubuntu node "$BG/live-check.js" "${live_args[@]}"); code=$?
    say "live: $LIVE"
    [ $code -eq 0 ] && break
    if [ "${FORCE:-0}" = 1 ]; then say "FORCE=1: switching anyway"; break; fi
    if [ "$waited" -lt "${WAIT_FOR_LIVE:-0}" ]; then sleep 30; waited=$((waited + 30)); continue; fi
    say "REFUSED: live games would lose state. Built dist-$NEW is kept; run again later (or WAIT_FOR_LIVE=1800)."
    exit 2
  done

  # Memory for two processes side by side (the old one's RSS plus a fresh one's ~250-350 MB).
  free=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  say "memory available: ${free} MB (need ${MIN_FREE_MB})"
  [ "$free" -ge "$MIN_FREE_MB" ] || { say "REFUSED: not enough memory for the overlap"; exit 1; }

  # The idle colour must be idle: not running in pm2 (that would mean nginx's file and pm2 disagree:
  # look with `status` first), nothing on its port. A stopped leftover is removed.
  if pm2j | python3 -c "import json,sys
try: apps=json.load(sys.stdin)
except Exception: sys.exit(0)  # cannot tell: treat as running
sys.exit(0 if any(p['name']=='sowaka-$NEW' and p['pm2_env']['status']=='online' for p in apps) else 1)"; then
    say "sowaka-$NEW is running although nginx points at :$OLD_PORT: not touching it (see status)"; exit 1
  fi
  pm2q delete "sowaka-$NEW" >/dev/null
  if ss -ltn "sport = :$NEW_PORT" | grep -q LISTEN; then say "port $NEW_PORT is in use: not starting"; exit 1; fi

  # The first deploy after `migrate`: the old single app runs its jobs without the lease, so the
  # lease is held in its name until it has stopped (lease.js), and the new copy waits for it.
  local legacy=0
  if pm2j | grep -q '"name":"sowaka-backend"'; then
    legacy=1
    (cd "$BE" && as_ubuntu node "$BG/lease.js" hold-legacy 20 --env "$BE/.env") || { say "could not hold the lease for sowaka-backend"; exit 1; }
  fi

  say "starting sowaka-$NEW on :$NEW_PORT ($(cat "$BE/dist-$NEW/BUILD" 2>/dev/null | head -c 12))"
  pm2q start "$BG/ecosystem.config.js" --only "sowaka-$NEW" | grep -E "sowaka-$NEW|rror" | head -2
  t0=$(date +%s)
  while true; do
    code=$(ready_code "$NEW_PORT")
    [ "$code" = 200 ] && break
    if [ $(( $(date +%s) - t0 )) -ge "$READY_TIMEOUT" ]; then
      say "NOT READY after ${READY_TIMEOUT}s (last: $code $(cat /tmp/bluegreen-ready.json 2>/dev/null)); stopping it, nginx untouched"
      pm2q stop "sowaka-$NEW" >/dev/null; pm2q delete "sowaka-$NEW" >/dev/null
      [ "$legacy" = 1 ] && (cd "$BE" && as_ubuntu node "$BG/lease.js" release-legacy --env "$BE/.env" >/dev/null)
      exit 3
    fi
    sleep 2
  done
  say "sowaka-$NEW ready in $(( $(date +%s) - t0 ))s: $(cat /tmp/bluegreen-ready.json)"

  if ! switch_to "$NEW_PORT"; then
    say "SWITCH FAILED: :$OLD_PORT keeps serving; stopping sowaka-$NEW"
    switch_to "$OLD_PORT" >/dev/null 2>&1 || true
    pm2q stop "sowaka-$NEW" >/dev/null; pm2q delete "sowaka-$NEW" >/dev/null
    [ "$legacy" = 1 ] && (cd "$BE" && as_ubuntu node "$BG/lease.js" release-legacy --env "$BE/.env" >/dev/null)
    exit 4
  fi

  # The old copy: out of nginx now. A few seconds for requests already sent to it to arrive, then
  # stop it: it drains (SHUTDOWN_DRAIN_MS), its sockets close (phones reconnect to the new copy),
  # its background jobs finish and it lets the lease go (the new copy takes the jobs within ~1 s).
  sleep 3
  if pm2j | grep -q "\"name\":\"sowaka-$OLD\""; then
    say "stopping sowaka-$OLD (drain, then the jobs hand over)"
    pm2q stop "sowaka-$OLD" | grep -E "stopped|rror" | head -1
    pm2q delete "sowaka-$OLD" >/dev/null
  elif pm2j | grep -q '"name":"sowaka-backend"'; then
    # The first blue/green deploy after migrate: the old single app.
    say "stopping the old single app sowaka-backend"
    pm2q stop sowaka-backend | grep -E "stopped|rror" | head -1
    pm2q delete sowaka-backend >/dev/null
  fi
  [ "$legacy" = 1 ] && (cd "$BE" && as_ubuntu node "$BG/lease.js" release-legacy --env "$BE/.env" | head -1)
  pm2q save >/dev/null

  # The background jobs: the new copy should hold the lease now.
  for _ in $(seq 1 40); do
    if health "$NEW_PORT" | grep -q '"leader":true'; then break; fi
    sleep 1
  done
  say "after: $(health "$NEW_PORT")"
  health "$NEW_PORT" | grep -q '"leader":true' || say "WARNING: sowaka-$NEW does not hold the background-jobs lease yet (it takes it once the old lease runs out, at most 30 s)"
}

deploy() {
  local ACTIVE NEW
  ACTIVE=$(colour_of "$(active_port)")
  [ -n "$ACTIVE" ] || { say "cannot tell the active colour from $UPSTREAM"; exit 1; }
  NEW=$(other "$ACTIVE")
  cd "$APP" || exit 1
  as_ubuntu git checkout -q main
  as_ubuntu git pull -q --ff-only origin main || { say "PULL FAILED"; exit 1; }
  say "main at $(as_ubuntu git log --oneline -1)"
  as_ubuntu npm install --no-audit --no-fund 2>&1 | tail -1
  cd "$BE" || exit 1
  # Build before anything else starts: tsc and two servers do not fit in 2 GB together.
  rm -rf "dist-$NEW.new"
  as_ubuntu env NODE_OPTIONS=--max-old-space-size=1300 npx tsc -p tsconfig.json --noCheck --outDir "dist-$NEW.new" || { say "BUILD FAILED; nothing changed"; exit 1; }
  as_ubuntu git -C "$APP" rev-parse HEAD | as_ubuntu tee "dist-$NEW.new/BUILD" >/dev/null
  rm -rf "dist-$NEW"; mv "dist-$NEW.new" "dist-$NEW"
  say "built dist-$NEW"
  cutover "$NEW"
}

# Once: the site's upstream becomes `include /etc/nginx/sowaka-upstream.conf` (pointing at :4000,
# where the single app already is). Backs the site file up; restores it if `nginx -t` fails.
migrate() {
  local SITE=/etc/nginx/sites-enabled/sowaka backup
  if grep -q 'sowaka-upstream.conf' "$SITE"; then say "already migrated"; return 0; fi
  backup="/root/nginx-sowaka.before-bluegreen.$(date -u +%Y%m%d%H%M%S)"
  cp "$SITE" "$backup"
  [ -f "$UPSTREAM" ] || printf '# Written by deploy/bluegreen/bluegreen.sh migrate. 4000 = blue, 4001 = green.\nserver 127.0.0.1:4000;\n' > "$UPSTREAM"
  # The running single app's build becomes blue's, so the first rollback has somewhere to go.
  if [ -d "$BE/dist" ] && [ ! -d "$BE/dist-blue" ]; then
    as_ubuntu cp -a "$BE/dist" "$BE/dist-blue"
    as_ubuntu git -C "$APP" rev-parse HEAD | as_ubuntu tee "$BE/dist-blue/BUILD" >/dev/null
  fi
  cp "$APP/docs/deploy/nginx-sowaka.conf" "$SITE"
  if ! nginx -t -q; then cp "$backup" "$SITE"; say "nginx -t FAILED: site restored from $backup"; exit 1; fi
  nginx -s reload
  say "migrated: upstream now from $UPSTREAM ($(active_port)); old site kept at $backup"
}

rollback() {
  local ACTIVE PREV
  ACTIVE=$(colour_of "$(active_port)")
  PREV=$(other "$ACTIVE")
  say "rolling back from $ACTIVE to $PREV (build $(cat "$BE/dist-$PREV/BUILD" 2>/dev/null | head -c 12))"
  cutover "$PREV"
}

case "${1:-status}" in
  status) status ;;
  deploy) deploy; status ;;
  rollback) rollback; status ;;
  migrate) migrate ;;
  switch) [ -n "${2:-}" ] || { echo "usage: switch 4000|4001"; exit 1; }; switch_to "$2" ;;
  *) echo "usage: $0 status|deploy|rollback|switch PORT|migrate"; exit 1 ;;
esac
