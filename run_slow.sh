#!/usr/bin/env bash
# One slow-desk run: older survivors, judged by Jev, scored at 1d / 3d / 7d.
# The systemd timer (deploy/jev-desk-slow.timer) runs this every 4 hours. It shares a
# lock with run_all.sh, so it never runs at the same time as a fast cycle (they share
# the GeckoTerminal and Solana budgets). Pricing happens in the fast cycle's score.py.
set -u
cd "$(dirname "$0")"
PY=.venv/bin/python
mkdir -p runs
exec 9>runs/.cycle.lock
flock -w 900 9 || { echo "!! a fast cycle held the lock for 15 min; skipping this slow run"; exit 0; }

echo "=== jev-desk slow run $(date -u +%FT%TZ) ==="
if $PY slow_scan.py; then
  $PY slow_judge.py || { echo "!! slow_judge failed (exit $?)"; exit 1; }
else
  echo "!! slow_scan failed (exit $?)"; exit 1
fi
