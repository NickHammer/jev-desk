"""Phase 4: the scorekeeper. Prices every judged token at 1h, 6h and 24h after its
judgement and prints a scorecard. Nothing is traded; this measures what WOULD have
happened, for picks, for tokens that passed, and for tokens Jev rejected.

    python score.py              price whatever is due, then print the scorecard
    python score.py --no-update  just print the scorecard

The question it answers: do the tokens the desk rejects really do worse than the ones
it passes, and is any single check throwing away winners?
"""

import argparse
import statistics
import time
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

import db                                                     # noqa: E402
import sources                                                # noqa: E402
from thresholds import CHECKPOINTS, ROUND_TRIP_COST_PCT       # noqa: E402

VERDICTS = ("pick", "pass", "reject")
SMALL = 30        # below this many results, a group is noise, not evidence


def update() -> tuple[int, int]:
    """Price every checkpoint that is due. Returns (filled, could_not_price)."""
    due = db.due_checkpoints()
    if not due:
        return 0, 0
    prices = sources.token_prices(sorted({d["addr"] for d in due}))
    filled = missing = 0
    now = time.time()
    for d in due:
        p = prices.get(d["addr"])
        if p is None:
            missing += 1                     # retried on later runs, then given up
            continue
        db.fill(d["id"], d["checkpoint"], p, (now - d["judged_at"]) / 60)
        filled += 1
    return filled, missing


def net_return(row: dict, cp: str) -> float | None:
    """Percent change from the judged price, minus the assumed round-trip cost."""
    p = row.get(f"p_{cp}")
    if p is None or not row["price0"]:
        return None
    return (p - row["price0"]) / row["price0"] * 100 - ROUND_TRIP_COST_PCT


def cell(values: list[float]) -> str:
    if not values:
        return f"{'-':>4} {'':>8} {'':>5}"
    avg = statistics.fmean(values)
    win = sum(v > 0 for v in values) / len(values) * 100
    return f"{len(values):>4} {avg:>+7.1f}% {win:>4.0f}%"


def report():
    rows = db.tracked_rows()
    if not rows:
        print("Nothing tracked yet. Run `python run_judge.py` a few times first.")
        return
    since = time.strftime("%Y-%m-%d %H:%M", time.localtime(min(r["judged_at"] for r in rows)))
    print(f"SCORECARD: {len(rows)} token(s) tracked since {since}")
    print(f"returns are after an assumed {ROUND_TRIP_COST_PCT}% round-trip cost; "
          f"win = share that would have made money\n")

    header = "".join(f"  {' ' + cp + ' ':-^19}" for cp in CHECKPOINTS)
    sub = "".join(f"  {'n':>4} {'avg':>8} {'win':>5}" for _ in CHECKPOINTS)
    print(f"{'':<10}{header}\n{'verdict':<10}{sub}")
    for group in (*VERDICTS, "all"):
        members = rows if group == "all" else [r for r in rows if r["verdict"] == group]
        line = "".join("  " + cell([v for r in members
                                    if (v := net_return(r, cp)) is not None])
                       for cp in CHECKPOINTS)
        print(f"{group:<10}{line}")

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

    priced = sum(net_return(r, cp) is not None for r in rows for cp in CHECKPOINTS)
    pending = sum(r.get(f"p_{cp}") is None for r in rows for cp in CHECKPOINTS)
    print(f"\n{priced} checkpoint(s) priced, {pending} still pending or unpriceable.")
    smallest = min((sum(net_return(r, "24h") is not None for r in rows if r["verdict"] == v)
                    for v in ("pass", "reject")), default=0)
    if smallest < SMALL:
        print(f"Too early to conclude anything: aim for {SMALL}+ results per group "
              f"at 24h before trusting a difference.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-update", action="store_true")
    args = ap.parse_args()
    if not args.no_update:
        filled, missing = update()
        print(f"priced {filled} checkpoint(s)"
              + (f", {missing} could not be priced (will retry)" if missing else "") + "\n")
    report()


if __name__ == "__main__":
    main()
