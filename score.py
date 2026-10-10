"""Phase 4: the scorekeeper. Prices every judged token at 1h, 6h and 24h after its
judgement and prints a scorecard. Nothing is traded; this measures what WOULD have
happened, for picks, for tokens that passed, and for tokens Jev rejected.

    python score.py                     price whatever is due, then print the scorecard
    python score.py --no-update         just print the scorecard
    python score.py --settings current  only tokens judged under today's settings
    python score.py --settings 1a2b3c4d only tokens judged under that settings stamp

The questions it answers: do Jev's passes beat the control group (random tokens that
passed the free market check, never judged)? Do rejected tokens really do worse? Is any
single check throwing away winners?
"""

import argparse
import statistics
import time
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

import db                                                     # noqa: E402
import events                                                 # noqa: E402
import settings_stamp                                         # noqa: E402
import sources                                                # noqa: E402
from thresholds import CHECKPOINTS, ROUND_TRIP_COST_PCT       # noqa: E402

VERDICTS = ("pick", "pass", "reject")
GROUPS = (*VERDICTS, "judged", "control")   # judged = pick + pass + reject
SMALL = 30        # below this many results, a group is noise, not evidence


def update() -> tuple[int, int]:
    """Price every checkpoint that is due. Returns (filled, could_not_price)."""
    due = db.due_checkpoints()
    events.emit("score", "start", due=len(due))
    if not due:
        return 0, 0
    prices = sources.token_prices(sorted({d["addr"] for d in due}))
    filled = missing = 0
    now = time.time()
    for d in due:
        p = prices.get(d["addr"])
        if p is None:
            missing += 1                     # retried while its window is still open
            db.no_price(d["id"], d["checkpoint"])
            continue
        db.fill(d["id"], d["checkpoint"], p, (now - d["judged_at"]) / 60)
        filled += 1
        gross = (p - d["price0"]) / d["price0"] * 100 if d["price0"] else None
        events.emit("score", "priced", ticker=d["ticker"], addr=d["addr"],
                    checkpoint=d["checkpoint"], verdict=d["verdict"], gross=gross,
                    net=None if gross is None else gross - ROUND_TRIP_COST_PCT)
    return filled, missing


def net_return(row: dict, cp: str, worst: bool = False) -> float | None:
    """Percent change from the judged price, minus the assumed round-trip cost.
    worst=True also counts a checkpoint that is 'gone' (no price at all) as -100%."""
    p = row.get(f"p_{cp}")
    if p is None or not row["price0"]:
        if worst and db.checkpoint_state(row, cp) == "gone":
            return -100.0 - ROUND_TRIP_COST_PCT
        return None
    return (p - row["price0"]) / row["price0"] * 100 - ROUND_TRIP_COST_PCT


def members_of(rows: list[dict], group: str) -> list[dict]:
    if group == "judged":
        return [r for r in rows if r["verdict"] != "control"]
    return [r for r in rows if r["verdict"] == group]


def table(rows: list[dict], sub: str, worst: bool = False):
    print(f"{'group':<10}{sub}")
    for group in GROUPS:
        members = members_of(rows, group)
        line = "".join("  " + cell([v for r in members
                                    if (v := net_return(r, cp, worst)) is not None])
                       for cp in CHECKPOINTS)
        print(f"{group:<10}{line}")


def cell(values: list[float]) -> str:
    if not values:
        return f"{'-':>4} {'':>8} {'':>5}"
    avg = statistics.fmean(values)
    win = sum(v > 0 for v in values) / len(values) * 100
    return f"{len(values):>4} {avg:>+7.1f}% {win:>4.0f}%"


def report(settings: str | None = None):
    rows = db.tracked_rows()
    stamps = defaultdict(int)
    for r in rows:
        stamps[r.get("config") or "unstamped"] += 1
    if settings:
        want = settings_stamp.current() if settings == "current" else settings
        rows = [r for r in rows if r.get("config") == want]
        print(f"settings {want} only\n")
    if not rows:
        print("Nothing tracked yet. Run `python run_judge.py` a few times first.")
        return
    since = time.strftime("%Y-%m-%d %H:%M", time.localtime(min(r["judged_at"] for r in rows)))
    judged = sum(r["verdict"] != "control" for r in rows)
    print(f"SCORECARD: {len(rows)} token(s) tracked since {since} "
          f"({judged} judged by Jev, {len(rows) - judged} in the control group)")
    print(f"returns are after an assumed {ROUND_TRIP_COST_PCT}% round-trip cost; "
          f"win = share that would have made money")
    print("control = random tokens that passed the free market check, never judged: "
          "the baseline Jev has to beat\n")

    header = "".join(f"  {' ' + cp + ' ':-^19}" for cp in CHECKPOINTS)
    sub = "".join(f"  {'n':>4} {'avg':>8} {'win':>5}" for _ in CHECKPOINTS)
    print(f"{'':<10}{header}")
    table(rows, sub)

    gone = sum(db.checkpoint_state(r, cp) == "gone" for r in rows for cp in CHECKPOINTS)
    if gone:
        print(f"\nworst case: the same, with every 'gone' checkpoint (no price at all, likely "
              f"rugged) counted as -100%")
        table(rows, sub, worst=True)

    # Which checks reject tokens, and how did those tokens actually do?
    by_check = defaultdict(list)
    for r in rows:
        if r["verdict"] == "reject":
            for f in r["fails"]:
                by_check[f].append(r)
    if by_check:
        print(f"\nrejected tokens by check (a token counts under every check it failed)")
        print(f"{'check':<28}{sub}")
        for check, members in sorted(by_check.items(), key=lambda kv: -len(kv[1])):
            line = "".join("  " + cell([v for r in members
                                        if (v := net_return(r, cp)) is not None])
                           for cp in CHECKPOINTS)
            print(f"{check[:27]:<28}{line}")

    states = [db.checkpoint_state(r, cp) for r in rows for cp in CHECKPOINTS]
    print(f"\ncheckpoints: {states.count('priced')} priced, {states.count('pending')} pending, "
          f"{states.count('gone')} gone (no price at all: likely rugged or delisted), "
          f"{states.count('missed')} missed (window closed with too few tries)")
    if not settings and len(stamps) > 1:
        cur = settings_stamp.current()
        print("settings: " + ", ".join(
            f"{k}{' (current)' if k == cur else ''} {n}" for k, n in stamps.items())
            + "  ->  `python score.py --settings current` to see only today's settings")
    smallest = min((sum(net_return(r, "24h") is not None for r in members_of(rows, g))
                    for g in ("pass", "control")), default=0)
    if smallest < SMALL:
        print(f"Too early to conclude anything: aim for {SMALL}+ results in both pass and "
              f"control at 24h before trusting a difference.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-update", action="store_true")
    ap.add_argument("--settings", metavar="STAMP",
                    help="only tokens judged under this settings stamp ('current' for today's)")
    args = ap.parse_args()
    if not args.no_update:
        filled, missing = update()
        print(f"priced {filled} checkpoint(s)"
              + (f", {missing} could not be priced (will retry)" if missing else "") + "\n")
        events.emit("score", "done", priced=filled, unpriceable=missing)
    report(args.settings)


if __name__ == "__main__":
    main()
