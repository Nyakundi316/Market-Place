#!/usr/bin/env bash
# One k6 run for .github/workflows/load.yml, with its result on the job page.
#   load/ci.sh <listings|chat> <peak>      env: MODE (smoke|ramp), RTT_MS, API_URL, JWT_ACCESS_SECRET
# In ramp mode a broken threshold (k6 exit 99) is the finding, not a failure.
set -uo pipefail

script=$1
peak=$2
args=(-e "RTT_MS=${RTT_MS:-0}")
if [ "$MODE" = smoke ]; then args+=(-e SMOKE=1); else args+=(-e "PEAK=$peak"); fi

k6 run "${args[@]}" "load/$script.js" 2>&1 | tee "k6-$script.txt"
code=${PIPESTATUS[0]}

{
  if [ "$MODE" = smoke ]; then echo "### $script (smoke)"; else echo "### $script (ramp to $peak)"; fi
  if [ "$code" = 99 ] && [ "$MODE" = ramp ]; then
    echo "Stopped at the first broken threshold: \`vus\` max below is roughly the level it held."
  elif [ "$code" = 0 ] && [ "$MODE" = ramp ]; then
    echo "Held the full peak without breaking a threshold; try a higher one."
  fi
  echo '```'
  sed -n '/THRESHOLDS/,$p' "k6-$script.txt"
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

[ "$code" = 0 ] || { [ "$code" = 99 ] && [ "$MODE" = ramp ]; }
