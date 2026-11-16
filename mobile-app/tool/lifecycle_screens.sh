#!/usr/bin/env bash
# Draws every employee-lifecycle screen of the app as a PNG (393 x 852 at 3x,
# the app's fonts and theme, data from test/fixtures/lifecycle), for review.
#
#   tool/lifecycle_screens.sh [out-dir]
#
# out-dir defaults to ~/Downloads/sowaka-lifecycle-screens/app. Its old PNGs
# are replaced. results.json beside them lists, per picture, any layout error
# or exception the real widgets raised (overflows are app bugs).
#
# Fresh server data first, if the backend changed:
#   (cd backend && npm run lifecycle:fixtures)
#
# On a shared machine set HEAVY_LOCK to a lock file to queue behind other
# heavy jobs (the run is one flutter_tester process, about 1.5 GB).
set -euo pipefail

app_dir="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$HOME/Downloads/sowaka-lifecycle-screens/app}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
find "$out" -maxdepth 1 \( -name '*.png' -o -name 'results.json' \) -delete

cd "$app_dir"
# The fixtures' times are read in India's time zone, as the app's users are.
export TZ="${TZ:-Asia/Kolkata}"
run=(flutter test test/screenshots --tags screenshots --dart-define=SCREENS_OUT="$out" --reporter expanded)
if [[ -n "${HEAVY_LOCK:-}" ]]; then
  lockf -k "$HEAVY_LOCK" "${run[@]}"
else
  "${run[@]}"
fi

count=$(find "$out" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')
echo "$count PNGs in $out"
