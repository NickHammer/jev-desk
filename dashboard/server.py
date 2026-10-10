"""Nick's Jev Trading Desk: the dashboard server.

Serves the dashboard page and a small read-only JSON API built from the desk's own
files (desk.db, runs/latest.json, runs/judged-latest.json, runs/events.jsonl).
It never writes to the desk, never trades, and never serves .env or any key.

    .venv/bin/python dashboard/server.py              # http://<pi>:8080
    .venv/bin/python dashboard/server.py --port 8090

Endpoints
    GET /api/state                 everything the panels show, in one object
    GET /api/events?since=<unix>   events after a time (live animation)
    GET /api/cycle[?id=<cycle>]    every event of one cycle (default: the last finished)
    GET /api/ohlcv?pool=<address>  5-minute candles for one pool, cached
"""

import argparse
import json
import sqlite3
import statistics
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import events                                                    # noqa: E402
from thresholds import (HARD, SOFT, SHAPE_MIN_CROWD, CHECKPOINTS,  # noqa: E402
                        ROUND_TRIP_COST_PCT, PICK_MIN_WORTH, PICK_MIN_CONF)

STATIC = Path(__file__).resolve().parent / "static"
RUNS = ROOT / "runs"
DB_PATH = ROOT / "desk.db"
TITLE = "Nick's Jev Trading Desk"
CYCLE_MINUTES = 15

GT = "https://api.geckoterminal.com/api/v2"
OHLCV_CACHE_SECONDS = 300
OHLCV_MIN_GAP_SECONDS = 30       # the pipeline owns the GT budget; stay well under it


# --- reading the desk (all read-only) ------------------------------------------

def _db():
    if not DB_PATH.exists():
        return None
    return sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5)


def _json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _net(row, cp):
    p, p0 = row.get(f"p_{cp}"), row.get("price0")
    if p is None or not p0:
        return None
    return (p - p0) / p0 * 100 - ROUND_TRIP_COST_PCT


def _cell(values):
    if not values:
        return {"n": 0, "avg": None, "win": None}
    return {"n": len(values), "avg": round(statistics.fmean(values), 2),
            "win": round(sum(v > 0 for v in values) / len(values) * 100)}


def scorecard():
    con = _db()
    if con is None:
        return {"rows": [], "by_verdict": {}, "by_check": {}, "counts": {}}
    try:
        cols = [c[1] for c in con.execute("PRAGMA table_info(tracked)")]
        rows = [dict(zip(cols, r)) for r in con.execute(
            "SELECT * FROM tracked ORDER BY judged_at")] if cols else []
        watch = con.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
        benched = con.execute("SELECT COUNT(*) FROM bench WHERE until > ?",
                              (time.time(),)).fetchone()[0]
    except sqlite3.Error:
        rows, watch, benched = [], None, None
    finally:
        con.close()
    for r in rows:
        r["fails"] = json.loads(r.get("fails") or "[]")
        r["net"] = {cp: _net(r, cp) for cp in CHECKPOINTS}

    by_verdict = {}
    judged = [r for r in rows if r["verdict"] != "control"]
    for group in ("pick", "pass", "reject", "control", "all"):
        # "all" means every token Jev judged; the control group is kept apart
        members = judged if group == "all" else [r for r in rows if r["verdict"] == group]
        by_verdict[group] = {cp: _cell([r["net"][cp] for r in members
                                        if r["net"][cp] is not None]) for cp in CHECKPOINTS}
    checks = defaultdict(list)
    for r in rows:
        if r["verdict"] == "reject":
            for f in r["fails"]:
                checks[f].append(r)
    by_check = {k: {cp: _cell([r["net"][cp] for r in v if r["net"][cp] is not None])
                    for cp in CHECKPOINTS}
                for k, v in sorted(checks.items(), key=lambda kv: -len(kv[1]))}
    series = [{"t": r["judged_at"], "ticker": r["ticker"], "verdict": r["verdict"],
               "net": r["net"]} for r in rows]
    return {"series": series, "by_verdict": by_verdict, "by_check": by_check,
            "counts": {"tracked": len(rows), "judged": len(judged),
                       "control": len(rows) - len(judged), "watchlist": watch, "benched": benched}}


def _cycles(evts):
    """Group events by cycle id, oldest first."""
    out = defaultdict(list)
    for e in evts:
        out[e.get("cycle")].append(e)
    return dict(sorted(out.items(), key=lambda kv: kv[1][0]["t"]))


def cycle_summary(evts):
    """What each stage did in one cycle: the last event of each (stage, kind)."""
    s = {}
    for e in evts:
        s.setdefault(e["stage"], {})[e["kind"]] = e
    return s


def merge_stages(old: dict, new: dict) -> dict:
    """Per stage and per event kind, the newest wins; older kinds fill the gaps."""
    out = {k: dict(v) for k, v in old.items()}
    for stage, kinds in new.items():
        out.setdefault(stage, {}).update(kinds)
    return out


def state():
    now = time.time()
    recent = events.read(since=now - 24 * 3600)
    cycles = _cycles(recent)
    ids = list(cycles)
    last = cycles[ids[-1]] if ids else []
    running = bool(last) and not any(e["kind"] == "cycle_end" for e in last) \
        and now - last[-1]["t"] < CYCLE_MINUTES * 60
    finished = [cid for cid in ids if any(e["kind"] == "cycle_end" for e in cycles[cid])]
    shown_id = ids[-1] if running else (finished[-1] if finished else (ids[-1] if ids else None))
    shown = cycles.get(shown_id, [])

    midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    usage_today = [e for e in recent if e["kind"] == "usage" and e["t"] >= midnight]
    decisions = [e for e in recent if e["stage"] == "pick" and e["kind"] == "decision"]

    finalists = _json(RUNS / "latest.json", [])
    judged = _json(RUNS / "judged-latest.json", {})
    answers = {j["addr"]: j for j in judged.get("judged", [])}
    for f in finalists:
        j = answers.get(f["addr"])
        f["judged"] = None if j is None else {"fails": j.get("fails"),
                                              "answers": j.get("answers")}

    next_cycle = (int(now // (CYCLE_MINUTES * 60)) + 1) * CYCLE_MINUTES * 60
    return {
        "title": TITLE, "now": now,
        "desk": {"running": running, "cycle": shown_id, "next_cycle": next_cycle,
                 "cycles_today": sum(1 for cid in finished
                                     if cycles[cid][0]["t"] >= midnight),
                 "last_end": next((e for e in reversed(recent)
                                   if e["kind"] == "cycle_end"), None)},
        # while a cycle runs, anything it hasn't reported yet keeps the last finished results
        "stages": merge_stages(cycle_summary(cycles[finished[-1]]) if running and finished
                               and finished[-1] != shown_id else {}, cycle_summary(shown)),
        "live_stages": list(cycle_summary(shown)) if running else [],
        "finalists": finalists,
        "judged_at": judged.get("at"), "models": judged.get("models"),
        "pick": judged.get("pick"), "no_trade_reason": judged.get("no_trade_reason"),
        "decisions": decisions[-12:],
        "jev_today": {"calls": sum(e.get("calls", 0) for e in usage_today),
                      "tokens": sum(e.get("tokens", 0) for e in usage_today),
                      "cost": round(sum(e.get("cost", 0) for e in usage_today), 5)},
        "thresholds": {"hard": HARD, "soft": {k: list(v) for k, v in SOFT.items()},
                       "shape_min_crowd": SHAPE_MIN_CROWD, "pick_min_worth": PICK_MIN_WORTH,
                       "pick_min_conf": PICK_MIN_CONF, "cost_pct": ROUND_TRIP_COST_PCT},
        "score": scorecard(),
    }


# --- candles, cached and rate-limited ------------------------------------------

_ohlcv_cache: dict[str, tuple[float, list]] = {}
_ohlcv_lock = threading.Lock()
_ohlcv_last_call = [0.0]


def ohlcv(pool: str):
    if not pool or not pool.isalnum() or len(pool) > 64:
        return {"error": "bad pool address"}
    with _ohlcv_lock:
        hit = _ohlcv_cache.get(pool)
        if hit and time.time() - hit[0] < OHLCV_CACHE_SECONDS:
            return {"pool": pool, "candles": hit[1], "cached": True}
        if time.time() - _ohlcv_last_call[0] < OHLCV_MIN_GAP_SECONDS:
            return {"pool": pool, "candles": hit[1] if hit else [], "cached": True,
                    "note": "rate limited, try again shortly"}
        _ohlcv_last_call[0] = time.time()
        try:
            r = requests.get(f"{GT}/networks/solana/pools/{pool}/ohlcv/minute",
                             params={"aggregate": 5, "limit": 96},
                             headers={"Accept": "application/json"}, timeout=15)
            r.raise_for_status()
            rows = ((r.json().get("data") or {}).get("attributes") or {}).get("ohlcv_list") or []
            candles = sorted([[int(t), o, h, lo, c, v] for t, o, h, lo, c, v in rows])
        except Exception as e:
            return {"pool": pool, "candles": hit[1] if hit else [], "error": str(e)[:120]}
        _ohlcv_cache[pool] = (time.time(), candles)
        return {"pool": pool, "candles": candles, "cached": False}


# --- HTTP ------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):            # keep the journal quiet
        pass

    def _send_json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj, default=str, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/state":
                return self._send_json(state())
            if url.path == "/api/events":
                return self._send_json(events.read(since=float(q.get("since", 0)), limit=3000))
            if url.path == "/api/cycle":
                evts = events.read(since=time.time() - 24 * 3600)
                cycles = _cycles(evts)
                cid = q.get("id") or next(
                    (c for c in reversed(list(cycles))
                     if any(e["kind"] == "cycle_end" for e in cycles[c])), None)
                return self._send_json({"cycle": cid, "events": cycles.get(cid, [])})
            if url.path == "/api/ohlcv":
                return self._send_json(ohlcv(q.get("pool", "")))
        except Exception as e:
            return self._send_json({"error": str(e)[:200]}, HTTPStatus.INTERNAL_SERVER_ERROR)
        if url.path.startswith("/api/"):
            return self._send_json({"error": "unknown endpoint"}, HTTPStatus.NOT_FOUND)
        return super().do_GET()                    # static files from dashboard/static only


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"{TITLE}: serving on http://{args.host}:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
