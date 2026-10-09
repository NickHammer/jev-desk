"""The desk's memory between runs: which tokens we're watching, which are benched,
and (Phase 4) every judged token's price so its outcome can be scored later.
Creates desk.db next to this file on first use; new tables are added automatically."""

import json
import sqlite3
import time
from pathlib import Path

from thresholds import (BENCH_MINUTES, DEFAULT_BENCH, HARD, CHECKPOINTS,
                        TRACK_DEDUP_HOURS, GIVE_UP_FACTOR)

DB = sqlite3.connect(Path(__file__).with_name("desk.db"))
DB.executescript("""
CREATE TABLE IF NOT EXISTS watchlist(
  addr TEXT PRIMARY KEY, symbol TEXT, first_seen REAL, source TEXT);
CREATE TABLE IF NOT EXISTS bench(
  addr TEXT PRIMARY KEY, reason TEXT, until REAL);
CREATE TABLE IF NOT EXISTS tracked(
  id INTEGER PRIMARY KEY, addr TEXT, ticker TEXT, run TEXT, judged_at REAL,
  verdict TEXT, fails TEXT, price0 REAL,
  p_1h REAL, min_1h REAL, p_6h REAL, min_6h REAL, p_24h REAL, min_24h REAL);
""")


def watch(tokens: list[dict], source: str) -> int:
    """Add newly discovered tokens. Returns how many were new."""
    before = DB.total_changes
    DB.executemany(
        "INSERT OR IGNORE INTO watchlist VALUES (?,?,?,?)",
        [(t["addr"], t["symbol"], time.time(), source) for t in tokens])
    DB.commit()
    return DB.total_changes - before


def prune() -> int:
    """Forget tokens we've watched longer than a launch stays a launch."""
    cutoff = time.time() - HARD["max_age_hours"] * 3600
    n = DB.execute("DELETE FROM watchlist WHERE first_seen < ?", (cutoff,)).rowcount
    DB.execute("DELETE FROM bench WHERE until < ?", (time.time(),))
    DB.commit()
    return n


def watched() -> list[dict]:
    """Newest first, so a capped market pass spends its calls on fresh launches."""
    rows = DB.execute("SELECT addr, symbol, first_seen FROM watchlist "
                      "ORDER BY first_seen DESC")
    return [{"addr": a, "symbol": s, "first_seen": f} for a, s, f in rows]


def drop(addr: str):
    """Stop watching a token for good (stale, or failed a permanent check)."""
    DB.execute("DELETE FROM watchlist WHERE addr=?", (addr,))
    DB.commit()


def benched(addr: str) -> bool:
    r = DB.execute("SELECT until FROM bench WHERE addr=?", (addr,)).fetchone()
    return bool(r and r[0] > time.time())


def sit(addr: str, reason: str):
    """Bench on the failed check, not the token: the reason sets the length."""
    mins = BENCH_MINUTES.get(reason, DEFAULT_BENCH)
    DB.execute("INSERT OR REPLACE INTO bench VALUES (?,?,?)",
               (addr, reason, time.time() + mins * 60))
    DB.commit()


# --- Phase 4: tracked outcomes ------------------------------------------------

def track(rows: list[dict], run: str) -> int:
    """Remember judged tokens with their price at judgement time.
    One row per token per TRACK_DEDUP_HOURS, so a token judged every run isn't counted
    many times; a pick is always recorded, even if the token was tracked earlier."""
    now, added = time.time(), 0
    for r in rows:
        if not r.get("price0") or r["price0"] <= 0:
            continue                                   # can't score without a start price
        recent = {v for (v,) in DB.execute(
            "SELECT verdict FROM tracked WHERE addr=? AND judged_at>?",
            (r["addr"], now - TRACK_DEDUP_HOURS * 3600))}
        if recent and not (r["verdict"] == "pick" and "pick" not in recent):
            continue
        DB.execute("INSERT INTO tracked(addr, ticker, run, judged_at, verdict, fails, price0)"
                   " VALUES (?,?,?,?,?,?,?)",
                   (r["addr"], r["ticker"], run, now, r["verdict"],
                    json.dumps(r.get("fails") or []), r["price0"]))
        added += 1
    DB.commit()
    return added


def due_checkpoints() -> list[dict]:
    """Checkpoints whose time has come and that haven't been priced yet."""
    now, out = time.time(), []
    for name, mins in CHECKPOINTS.items():
        due_after = mins * 60
        give_up = due_after * GIVE_UP_FACTOR
        for rid, addr, at in DB.execute(
                f"SELECT id, addr, judged_at FROM tracked WHERE p_{name} IS NULL "
                f"AND judged_at + ? <= ? AND judged_at + ? > ?",
                (due_after, now, give_up, now)):
            out.append({"id": rid, "addr": addr, "checkpoint": name, "judged_at": at})
    return out


def fill(rid: int, checkpoint: str, price: float, minutes: float):
    DB.execute(f"UPDATE tracked SET p_{checkpoint}=?, min_{checkpoint}=? WHERE id=?",
               (price, minutes, rid))
    DB.commit()


def tracked_rows() -> list[dict]:
    cols = [c[1] for c in DB.execute("PRAGMA table_info(tracked)")]
    rows = [dict(zip(cols, r)) for r in DB.execute("SELECT * FROM tracked")]
    for r in rows:
        r["fails"] = json.loads(r["fails"] or "[]")
    return rows
