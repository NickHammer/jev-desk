"""The desk's memory between runs: which tokens we're watching, and which are benched.
Creates desk.db next to this file on first use."""

import sqlite3
import time
from pathlib import Path

from thresholds import BENCH_MINUTES, DEFAULT_BENCH, HARD

DB = sqlite3.connect(Path(__file__).with_name("desk.db"))
DB.executescript("""
CREATE TABLE IF NOT EXISTS watchlist(
  addr TEXT PRIMARY KEY, symbol TEXT, first_seen REAL, source TEXT);
CREATE TABLE IF NOT EXISTS bench(
  addr TEXT PRIMARY KEY, reason TEXT, until REAL);
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


def watched() -> list[str]:
    return [r[0] for r in DB.execute("SELECT addr FROM watchlist")]


def benched(addr: str) -> bool:
    r = DB.execute("SELECT until FROM bench WHERE addr=?", (addr,)).fetchone()
    return bool(r and r[0] > time.time())


def sit(addr: str, reason: str):
    """Bench on the failed check, not the token: the reason sets the length."""
    mins = BENCH_MINUTES.get(reason, DEFAULT_BENCH)
    DB.execute("INSERT OR REPLACE INTO bench VALUES (?,?,?)",
               (addr, reason, time.time() + mins * 60))
    DB.commit()
