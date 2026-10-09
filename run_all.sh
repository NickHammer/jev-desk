#!/usr/bin/env bash
# One full cycle: scan for launches, judge the finalists, score earlier judgements.
# The systemd timer (deploy/) runs this every 15 minutes; it is also safe to run by hand.
set -u
cd "$(dirname "$0")"
PY=.venv/bin/python
rc=0

echo "=== jev-desk cycle $(date -u +%FT%TZ) ==="
if $PY run_scan.py; then
  $PY run_judge.py || { echo "!! run_judge failed (exit $?)"; rc=1; }
else
  echo "!! run_scan failed (exit $?); skipping the judge so old finalists aren't re-judged"
  rc=1
fi
$PY score.py || { echo "!! score failed (exit $?)"; rc=1; }
exit $rc
