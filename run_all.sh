#!/usr/bin/env bash
# One full cycle: scan for launches, judge the finalists, score earlier judgements.
# The systemd timer (deploy/) runs this every 15 minutes; it is also safe to run by hand.
set -u
cd "$(dirname "$0")"
PY=.venv/bin/python
rc=0
mkdir -p runs
exec 9>runs/.cycle.lock          # shared with run_slow.sh: never two cycles at once
flock -w 360 9 || { echo "!! a slow-desk run held the lock for 6 min; skipping this cycle"; exit 0; }
export JEV_CYCLE="$(date -u +%Y%m%dT%H%M%SZ)"   # shared by every step's events

echo "=== jev-desk cycle $(date -u +%FT%TZ) ==="
if $PY run_scan.py; then
  $PY run_judge.py || { echo "!! run_judge failed (exit $?)"; rc=1; }
else
  echo "!! run_scan failed (exit $?); skipping the judge so old finalists aren't re-judged"
  rc=1
fi
$PY score.py || { echo "!! score failed (exit $?)"; rc=1; }
# chain forensics last, so it never delays the scan or the judge; a failure here
# doesn't fail the cycle (it only records signals)
$PY forensics.py || echo "!! forensics failed (exit $?); signals only, cycle unaffected"
$PY -c "import events; events.emit('desk', 'cycle_end', rc=$rc)" || true
exit $rc
