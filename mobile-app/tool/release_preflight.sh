#!/bin/bash
# Release preflight: run before EVERY app build. It refuses a build that is not made on top of the
# build people have in the stores.
#
#   tool/release_preflight.sh [ref]            check ref (default HEAD) before building it
#   tool/release_preflight.sh --record STATUS  add HEAD's build to RELEASES.md (after a build)
#   SOWAKA_SSM=/path/ssm-run.sh tool/release_preflight.sh   also list the versions phones report
#
# Exits 0 when the build may go ahead and 1 when it must not.
# What it checks:
#   1. The version in pubspec.yaml has a build number above every build in RELEASES.md.
#   2. The ref contains the commit of the newest `live` build in RELEASES.md.
#   3. Every app commit on origin/main that the ref lacks is listed (a warning: a hotfix may leave
#      main's unreleased work out, but that has to be a choice someone made).
set -uo pipefail
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
LEDGER="$APP_DIR/RELEASES.md"
cd "$APP_DIR" || exit 1
red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

[ -f "$LEDGER" ] || { red "No RELEASES.md at $LEDGER"; exit 1; }

# Ledger rows as "version build commit branch status", newest first.
rows() {
  awk -F'|' '/^\| *[0-9]+\.[0-9]+\.[0-9]+ *\|/ {
    for (i = 2; i <= 6; i++) { gsub(/^ +| +$/, "", $i); if ($i == "") $i = "-" }
    print $2, $3, $4, $5, $6 }' "$LEDGER" | sort -k2,2nr
}

if [ "${1:-}" = "--record" ]; then
  STATUS=${2:?"--record needs a status: built, testflight, live"}
  VERSION_LINE=$(grep -E '^version:' pubspec.yaml | awk '{print $2}')
  V=${VERSION_LINE%+*}; B=${VERSION_LINE#*+}
  if rows | awk -v b="$B" '$2 == b { found = 1 } END { exit !found }'; then
    red "Build $B is already in RELEASES.md; change its row by hand."; exit 1
  fi
  ROW="| $V | $B | $(git rev-parse --short=8 HEAD) | $(git branch --show-current) | $STATUS | |"
  awk -v row="$ROW" '/^\|---/ && !done { print; print row; done = 1; next } { print }' "$LEDGER" > "$LEDGER.tmp" \
    && mv "$LEDGER.tmp" "$LEDGER"
  green "Recorded: $ROW"; exit 0
fi

REF=${1:-HEAD}
git rev-parse --verify -q "$REF^{commit}" >/dev/null || { red "Unknown ref $REF"; exit 1; }
git fetch -q origin 2>/dev/null || yellow "(could not fetch origin; using local refs)"
FAIL=0

echo "== Release preflight for $REF ($(git rev-parse --short=8 "$REF"))"

# 1. Version and build number.
VERSION_LINE=$(git show "$REF:mobile-app/pubspec.yaml" 2>/dev/null | grep -E '^version:' | awk '{print $2}')
BUILD=${VERSION_LINE#*+}
TOP=$(rows | head -1 | awk '{print $2}')
echo "Version in pubspec: $VERSION_LINE   highest build in ledger: $TOP"
if [ -z "$VERSION_LINE" ] || ! [ "$BUILD" -gt "$TOP" ] 2>/dev/null; then
  if rows | awk -v b="$BUILD" '$2 == b { found = 1 } END { exit !found }' \
     && [ "$(rows | awk -v b="$BUILD" '$2 == b {print $3}')" = "$(git rev-parse --short=8 "$REF")" ]; then
    yellow "Build $BUILD is already recorded for this exact commit (a rebuild of the same build)."
  else
    red "FAIL: build number $BUILD must be above $TOP. Bump version in pubspec.yaml."; FAIL=1
  fi
fi

# 2. Made on top of the live build.
LIVE=$(rows | awk '$5 == "live"' | head -1)
if [ -z "$LIVE" ]; then
  red "FAIL: no row marked live in RELEASES.md, so there is nothing to build on."; FAIL=1
else
  read -r LV LB LC LBR _ <<<"$LIVE"
  echo "Live in the stores: $LV ($LB) at $LC"
  if git merge-base --is-ancestor "$LC" "$REF" 2>/dev/null; then
    green "OK: $REF contains $LV ($LB)."
    echo "App changes since $LV ($LB):"
    git log --oneline --no-merges "$LC..$REF" -- . | sed 's/^/   + /' | head -40
  else
    # Commits of the live build the ref lacks, leaving out ones that only bump pubspec's version.
    DROPPED=""
    for c in $(git rev-list --no-merges --cherry-pick --right-only "$REF...$LC" -- .); do
      FILES=$(git show --format= --name-only "$c" -- . | grep -v '^$')
      [ "$FILES" = "mobile-app/pubspec.yaml" ] && continue
      DROPPED="$DROPPED$(git log -1 --oneline "$c")"$'\n'
    done
    if [ -z "$DROPPED" ]; then
      green "OK: $REF has every change of $LV ($LB); only its version bump is not an ancestor."
    else
      red "FAIL: $REF does NOT contain the live build $LV ($LB) $LC."
      echo "These app changes in $LV ($LB) would be dropped:"
      printf '%s' "$DROPPED" | sed 's/^/   - /' | head -60
      echo "Fix: build from the live build's branch ($LBR) or merge $LC into $REF first."
      FAIL=1
    fi
  fi
fi

# 3. Main's app work the build leaves out.
if git rev-parse -q --verify origin/main >/dev/null; then
  MISSING=$(git log --oneline --no-merges "$REF..origin/main" -- . | head -60)
  if [ -n "$MISSING" ]; then
    yellow "WARNING: app commits on origin/main that this build does not have (confirm they are meant to wait):"
    echo "$MISSING" | sed 's/^/   ~ /'
  else
    green "OK: every app commit on origin/main is in $REF."
  fi
fi

# Optional: what phones actually run, from the server's update checks.
if [ -n "${SOWAKA_SSM:-}" ] && [ -x "$SOWAKA_SSM" ]; then
  echo "Versions phones report (update checks in the server log):"
  "$SOWAKA_SSM" "cat /home/ubuntu/.pm2/logs/sowaka-backend-out*.log | grep -oE 'GET /app/update\?platform=(ios|android)&version=[0-9.]+(%2B|\+)[0-9]+' | sed -E 's/.*platform=//; s/&version=/ /; s/%2B/+/' | sort | uniq -c | sort -rn | head -8" 120 \
    | grep -v '^\[ssm' | sed 's/^/   /'
fi

if [ "$FAIL" -ne 0 ]; then red "== PREFLIGHT FAILED: do not build $REF."; exit 1; fi
green "== PREFLIGHT PASSED: $REF may be built. After building, run: tool/release_preflight.sh --record built"
