"""What-if: replay Jev's saved answers under different limits, without calling Jev
again and without waiting for new data. Read-only: it never changes the desk.

    python whatif.py                               today's limits (matches the scorecard)
    python whatif.py wash_trading=0.8 effort=0.5   change limits for this run only
    python whatif.py shape_min_crowd=0.4           the "real crowd" probability limit
    python whatif.py --drop wash_trading effort    ignore those checks entirely
    python whatif.py --sweep wash_trading          try a range of values for one check

Each judged token's answers come from runs/judged-*.json (kept 7 days) and its prices
from desk.db, so only tokens judged in the last 7 days can be replayed. The pick step
is not replayed (it needs a fresh Jev call), so "would pass" means survived every check.
Tokens that pass under looser limits were judged by the same Jev answers, so this shows
how they actually did, but a small group is still mostly luck.
"""

import argparse
import json
import statistics
from pathlib import Path

import db
import filter as F
from score import cell, net_return, HEADER, SUB
from thresholds import CHECKPOINTS, SOFT, SHAPE_MIN_CROWD

RUNS = Path(__file__).with_name("runs")
SWEEP = {"max": [0.6, 0.7, 0.8, 0.9, 1.0], "min": [1.0, 0.75, 0.5, 0.25, 0.0]}


def load() -> tuple[list[dict], list[dict]]:
    """Judged tokens that are both in a saved judged file and tracked with prices,
    plus the control tokens tracked over the same days."""
    answers = {}
    for f in sorted(RUNS.glob("judged-2*.json")):
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        for r in data.get("judged", []):
            if r.get("answers"):
                answers[(data.get("at"), r["addr"])] = r["answers"]
    rows = db.tracked_rows()
    judged = []
    for r in rows:
        if r["verdict"] != "control" and (r["run"], r["addr"]) in answers:
            judged.append({**r, "answers": answers[(r["run"], r["addr"])]})
    if not judged:
        return [], []
    lo, hi = min(r["judged_at"] for r in judged), max(r["judged_at"] for r in judged)
    control = [r for r in rows if r["verdict"] == "control" and lo <= r["judged_at"] <= hi]
    return judged, control


def replay(judged: list[dict], soft: dict, shape_min: float, drop: set[str]) -> list[dict]:
    """Re-run the real judge_fails() from filter.py with the given limits."""
    saved = F.SOFT, F.SHAPE_MIN_CROWD
    F.SOFT, F.SHAPE_MIN_CROWD = soft, shape_min
    try:
        out = []
        for r in judged:
            fails = [f for f in F.judge_fails(r["answers"])
                     if f not in drop and f.removesuffix("_missing") not in drop]
            out.append({**r, "would_fail": fails})
        return out
    finally:
        F.SOFT, F.SHAPE_MIN_CROWD = saved


def line(name: str, members: list[dict]) -> str:
    return f"{name:<16}" + "".join(
        "  " + cell([v for r in members if (v := net_return(r, cp)) is not None])
        for cp in CHECKPOINTS)


def describe(soft: dict, shape_min: float, drop: set[str]) -> str:
    changes = [f"{k} {d} {v:g} (now {SOFT[k][1]:g})" for k, (d, v) in soft.items()
               if k in SOFT and v != SOFT[k][1]]
    if shape_min != SHAPE_MIN_CROWD:
        changes.append(f"shape_min_crowd {shape_min:g} (now {SHAPE_MIN_CROWD:g})")
    if drop:
        changes.append("ignoring " + ", ".join(sorted(drop)))
    return "; ".join(changes) or "today's limits"


def report(judged, control, soft, shape_min, drop):
    res = replay(judged, soft, shape_min, drop)
    passed = [r for r in res if not r["would_fail"]]
    print(f"WHAT-IF: {describe(soft, shape_min, drop)}")
    print(f"replaying {len(res)} judged token(s) with Jev's saved answers; "
          f"control = {len(control)} random token(s) tracked over the same days\n")
    print(f"{'':<16}{HEADER}\n{'group':<16}{SUB}")
    print(line("would pass", passed))
    print(line("still rejected", [r for r in res if r["would_fail"]]))
    print(line("control", control))
    if passed:
        print(f"\ntokens that would pass ({len(passed)}):")
        for r in sorted(passed, key=lambda r: r["judged_at"]):
            nets = "  ".join(f"{cp} {'   -   ' if (v := net_return(r, cp)) is None else f'{v:+6.1f}%'}"
                             for cp in CHECKPOINTS)
            today = ", ".join(r["fails"]) or "passed"
            print(f"  {r['ticker'][:12]:<12} {nets}   (today: {today})")
    if describe(soft, shape_min, drop) == "today's limits":
        same = sum((not r["would_fail"]) == (r["verdict"] in ("pass", "pick")) for r in res)
        print(f"\ncheck: today's limits reproduce {same} of {len(res)} recorded verdicts"
              + ("" if same == len(res) else " (the rest were judged under older settings)"))
    print("\nNothing was changed. To use new limits for real, edit SOFT in thresholds.py.")


def sweep(judged, control, name):
    if name == "shape_min_crowd":
        direction, values = "min", [0.55, 0.45, 0.35, 0.25, 0.0]
    elif name in SOFT:
        direction, values = SOFT[name][0], SWEEP[SOFT[name][0]]
    else:
        raise SystemExit(f"unknown check {name!r}; choose from: {', '.join([*SOFT, 'shape_min_crowd'])}")
    print(f"SWEEP: {name} ({direction}), every other limit as today")
    print(f"control over the same days: "
          + ", ".join(f"{cp} median {statistics.median(v):+.1f}% (n={len(v)})"
                      for cp in CHECKPOINTS
                      if (v := [x for r in control if (x := net_return(r, cp)) is not None]))
          + "\n")
    print(f"{'limit':<16}{HEADER}\n{'would pass':<16}{SUB}")
    for val in values:
        soft = dict(SOFT)
        shape_min = SHAPE_MIN_CROWD
        if name == "shape_min_crowd":
            shape_min = val
        else:
            soft[name] = (direction, val)
        passed = [r for r in replay(judged, soft, shape_min, set()) if not r["would_fail"]]
        print(line(f"{val:g}", passed))
    print("\nA limit only passes more tokens if the other checks let them through too;")
    print("combine changes, e.g.  python whatif.py wash_trading=0.8 effort=0.5")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("limits", nargs="*", metavar="check=value")
    ap.add_argument("--drop", nargs="+", default=[], metavar="check")
    ap.add_argument("--sweep", metavar="check")
    args = ap.parse_args()

    judged, control = load()
    if not judged:
        raise SystemExit("No judged tokens with saved answers yet (runs/judged-*.json, last 7 days).")
    if args.sweep:
        return sweep(judged, control, args.sweep)

    soft, shape_min = dict(SOFT), SHAPE_MIN_CROWD
    for item in args.limits:
        name, _, raw = item.partition("=")
        try:
            val = float(raw)
        except ValueError:
            raise SystemExit(f"expected check=value, got {item!r}")
        if name == "shape_min_crowd":
            shape_min = val
        elif name in SOFT:
            soft[name] = (SOFT[name][0], val)
        else:
            raise SystemExit(f"unknown check {name!r}; choose from: {', '.join([*SOFT, 'shape_min_crowd'])}")
    unknown = [d for d in args.drop if d not in SOFT and not d.startswith("shape")]
    if unknown:
        raise SystemExit(f"unknown check(s) to drop: {', '.join(unknown)}")
    report(judged, control, soft, shape_min, set(args.drop))


if __name__ == "__main__":
    main()
