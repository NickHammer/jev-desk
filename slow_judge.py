"""The slow desk, step 2: Jev judges the slow finalists with the same questions and
SOFT limits as the fast desk, picks at most one, and tracks everything for scoring
at 1, 3 and 7 days. Nothing is traded, and it does not bench tokens or emit
dashboard events, so the fast desk is untouched.

    python slow_judge.py
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

import db                                                       # noqa: E402
import judge                                                    # noqa: E402
import settings_stamp                                           # noqa: E402
import signals                                                  # noqa: E402
from filter import judge_fails                                  # noqa: E402
from thresholds import PICK_MIN_WORTH, PICK_MIN_CONF, RUN_KEEP_DAYS   # noqa: E402

RUNS = Path(__file__).with_name("runs")


def prune_old_runs():
    cutoff = time.time() - RUN_KEEP_DAYS * 86400
    for f in RUNS.glob("judged-slow-*.json"):
        if f.stat().st_mtime < cutoff:
            f.unlink()


def pick_one(survivors, usages, models):
    """The same pick rule as the fast desk. Returns (pick or None, reason)."""
    if not survivors:
        return None, "no token passed Jev's checks"
    if len(survivors) == 1:
        return {"row": survivors[0], "via": "single survivor", "confidence": None}, None
    cands = [{"key": judge.candidate_key(r["dossier"]),
              "summary": judge.summary(r["dossier"], r["answers"])} for r in survivors]
    r = judge.ask("pick", {"candidates": cands})
    usages.append(r["usage"]); models.add(r["model"])
    best, worth = r["answers"]["best"], r["answers"]["worth_trading_at_all"]
    row = next((x for x in survivors if judge.candidate_key(x["dossier"]) == best["choice"]), None)
    if worth["noul"] < PICK_MIN_WORTH:
        return None, f"worth_trading_at_all {worth['noul']:.2f} < {PICK_MIN_WORTH}"
    if best["confidence"] < PICK_MIN_CONF:
        return None, f"pick confidence {best['confidence']:.2f} < {PICK_MIN_CONF}"
    if row is None:
        return None, f"pick returned unknown option {best['choice']!r}"
    return {"row": row, "via": "pick", "confidence": best["confidence"]}, None


def main():
    RUNS.mkdir(exist_ok=True)
    prune_old_runs()
    src = RUNS / "slow-latest.json"
    if not src.exists():
        sys.exit("No runs/slow-latest.json yet. Run `python slow_scan.py` first.")
    finalists = json.loads(src.read_text())
    print(f"slow desk: {len(finalists)} finalist(s)")
    usages, models, judged, survivors = [], set(), [], []
    for d in finalists:
        try:
            m = judge.ask("market", judge.market_state(d))
            p = judge.ask("project", judge.project_state(d))
        except judge.MalformedQuestion as e:
            sys.exit(f"Jev rejected a question as malformed; fix questions.py: {e}")
        except Exception as e:
            print(f"  {d['ticker']:<12} judge call failed: {e} (skipped, not a pass)")
            continue
        usages += [m["usage"], p["usage"]]
        models |= {m["model"], p["model"]}
        ans = {**m["answers"], **p["answers"]}
        fails = judge_fails(ans)
        row = {"addr": d["addr"], "ticker": d["ticker"], "kill": fails[0] if fails else None,
               "fails": fails, "answers": ans, "price_usd": d.get("price_usd"), "dossier": d}
        judged.append(row)
        if not fails:
            survivors.append(row)
        print(f"  {d['ticker'][:12]:<12} {d.get('source', ''):<9} -> {', '.join(fails) or 'PASS'}")

    pick, reason = pick_one(survivors, usages, models) if judged else (None, "no finalists")
    print(f"{len(survivors)} of {len(judged)} passed. "
          + (f"WOULD BUY (shadow, slow desk): {pick['row']['ticker']} via {pick['via']}" if pick
             else f"NO TRADE: {reason}"))
    tokens = judge.tokens_used(usages)
    print(f"Jev: {len(usages)} calls, {tokens:,} input tokens, ~${tokens / 1e6 * judge.PRICE_PER_MTOK:.5f}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = {"at": stamp, "desk": "slow", "models": sorted(models), "input_tokens": tokens,
           "pick": None if not pick else {"addr": pick["row"]["addr"], "ticker": pick["row"]["ticker"],
                                          "via": pick["via"], "confidence": pick["confidence"]},
           "no_trade_reason": reason,
           "judged": [{k: v for k, v in r.items() if k != "dossier"} for r in judged]}
    (RUNS / f"judged-slow-{stamp}.json").write_text(json.dumps(out, indent=2, default=str))

    settings = settings_stamp.current("slow")
    db.remember_settings(settings, settings_stamp.settings_json("slow"))
    picked = pick["row"]["addr"] if pick else None
    promo = signals.promotion([r["addr"] for r in judged])
    added = db.track(
        [{"addr": r["addr"], "ticker": r["ticker"], "price0": r["price_usd"],
          "verdict": "pick" if r["addr"] == picked else ("pass" if not r["fails"] else "reject"),
          "fails": r["fails"], "signals": signals.build(r["dossier"], promo.get(r["addr"]))}
         for r in judged], run=stamp, stamp=settings, desk="slow")
    print(f"slow desk: tracking {added} new token(s) (scored at 1d / 3d / 7d)")


if __name__ == "__main__":
    main()
