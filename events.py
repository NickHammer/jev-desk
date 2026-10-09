"""The desk's event log: one JSON line per thing that happens, appended to
runs/events.jsonl. The dashboard animates from this file; nothing in the pipeline
reads it back, and a failure to write an event never stops a cycle.

Every event has: t (unix time), cycle (the cycle's id), stage, kind, plus its own fields.
"""

import json
import os
import time
from pathlib import Path

EVENTS = Path(__file__).with_name("runs") / "events.jsonl"
KEEP_HOURS = 48

# run_all.sh exports JEV_CYCLE so every step of one cycle shares an id
CYCLE = os.environ.get("JEV_CYCLE") or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def _round(v):
    return round(v, 4) if isinstance(v, float) else v


def emit(stage: str, kind: str, **data):
    """Append one event. Floats are rounded to keep the file small."""
    try:
        EVENTS.parent.mkdir(exist_ok=True)
        rec = {"t": round(time.time(), 3), "cycle": CYCLE, "stage": stage, "kind": kind,
               **{k: _round(v) for k, v in data.items()}}
        with EVENTS.open("a") as f:
            f.write(json.dumps(rec, default=str, separators=(",", ":")) + "\n")
    except Exception:
        pass                                   # the log is decoration, never a dependency


def prune() -> int:
    """Drop events older than KEEP_HOURS. Called once per cycle by run_scan."""
    if not EVENTS.exists():
        return 0
    cutoff = time.time() - KEEP_HOURS * 3600
    keep, dropped = [], 0
    for line in EVENTS.read_text().splitlines():
        try:
            if json.loads(line)["t"] >= cutoff:
                keep.append(line)
                continue
        except (ValueError, KeyError):
            pass
        dropped += 1
    if dropped:
        tmp = EVENTS.with_suffix(".tmp")
        tmp.write_text("\n".join(keep) + ("\n" if keep else ""))
        tmp.replace(EVENTS)
    return dropped


def read(since: float = 0, cycle: str | None = None, limit: int = 5000) -> list[dict]:
    """Events after `since` (or for one cycle), oldest first. Used by the dashboard."""
    if not EVENTS.exists():
        return []
    out = []
    for line in EVENTS.read_text().splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("t", 0) <= since or (cycle and e.get("cycle") != cycle):
            continue
        out.append(e)
    return out[-limit:]
