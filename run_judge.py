"""Phase 3: ask Jev about the finalists from the last scan. Shadow only, no trading.

    python run_scan.py      first, to produce runs/latest.json
    python run_judge.py     then this

Two calls per finalist (market, project), one pick call over the survivors.
Everything is saved to runs/judged-<UTC time>.json and runs/judged-latest.json.
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

import judge                                                    # noqa: E402
from filter import judge_kill                                   # noqa: E402
from thresholds import (PICK_MIN_WORTH, PICK_MIN_CONF,          # noqa: E402
                        NO_SOCIAL_CUT)

RUNS = Path(__file__).with_name("runs")


def num(ans, name):
    a = ans.get(name) or {}
    v = a.get("noul", a.get("score"))
    return "  -  " if v is None else f"{v:5.2f}"


def main():
    src = RUNS / "latest.json"
    if not src.exists():
        sys.exit("No runs/latest.json yet. Run `python run_scan.py` first.")
    finalists = json.loads(src.read_text())
    age_min = (time.time() - src.stat().st_mtime) / 60
    print(f"{len(finalists)} finalist(s) from a scan {age_min:.0f} min ago"
          + ("  (stale: consider re-running run_scan.py)" if age_min > 20 else ""))
    if not finalists:
        return

    usages, models, judged, survivors = [], set(), [], []
    print(f"\n  {'token':<12} {'shape':<10} crowd  fits  spent  conc   dev  wash  effort copy  -> result")
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
        k = judge_kill(ans)
        shape = ans.get("shape") or {}
        crowd = (shape.get("probabilities") or {}).get("crowd")
        print(f"  {d['ticker'][:12]:<12} {str(shape.get('choice'))[:10]:<10} "
              f"{'  -  ' if crowd is None else f'{crowd:5.2f}'} "
              f"{num(ans, 'liquidity_fits_ticket')} {num(ans, 'momentum_already_spent')} "
              f"{num(ans, 'concentration_is_exit_risk')} {num(ans, 'dev_still_loaded')} "
              f"{num(ans, 'wash_trading')} {num(ans, 'effort')}  {num(ans, 'copycat')} "
              f" -> {k or 'PASS'}")
        row = {"addr": d["addr"], "ticker": d["ticker"], "kill": k, "answers": ans,
               "price_usd": d.get("price_usd"), "dossier": d}
        judged.append(row)
        if not k:
            survivors.append(row)

    # The pick. A choice over one option proves nothing, so one survivor skips it.
    pick, reason = None, None
    if not survivors:
        reason = "no token passed Jev's checks"
    elif len(survivors) == 1:
        pick = {"key": judge.candidate_key(survivors[0]["dossier"]), "row": survivors[0],
                "confidence": None, "worth": None, "via": "single survivor"}
    else:
        cands = [{"key": judge.candidate_key(r["dossier"]),
                  "summary": judge.summary(r["dossier"], r["answers"])} for r in survivors]
        try:
            r = judge.ask("pick", {"candidates": cands})
        except judge.MalformedQuestion as e:
            sys.exit(f"Jev rejected the pick question: {e}")
        usages.append(r["usage"])
        models.add(r["model"])
        best, worth = r["answers"]["best"], r["answers"]["worth_trading_at_all"]
        row = next((x for x in survivors
                    if judge.candidate_key(x["dossier"]) == best["choice"]), None)
        if worth["noul"] < PICK_MIN_WORTH:
            reason = f"worth_trading_at_all {worth['noul']:.2f} < {PICK_MIN_WORTH}"
        elif best["confidence"] < PICK_MIN_CONF:
            reason = f"pick confidence {best['confidence']:.2f} < {PICK_MIN_CONF}"
        elif row is None:
            reason = f"pick returned unknown option {best['choice']!r}"
        else:
            pick = {"key": best["choice"], "row": row, "confidence": best["confidence"],
                    "worth": worth["noul"], "via": "pick",
                    "runner_up": sorted(best["probabilities"].items(),
                                        key=lambda kv: -kv[1])[1:2]}

    tokens = judge.tokens_used(usages)
    print(f"\n{len(survivors)} of {len(judged)} passed Jev's checks.")
    if pick:
        rw = pick["row"]
        conf = "" if pick["confidence"] is None else f", confidence {pick['confidence']:.2f}"
        print(f"WOULD BUY (shadow): {rw['ticker']} {rw['addr']}\n"
              f"   via {pick['via']}{conf}, size factor {NO_SOCIAL_CUT} (no X account read), "
              f"price ${rw['price_usd']}")
    else:
        print(f"NO TRADE: {reason}")
    print(f"Jev: {len(usages)} calls, {tokens:,} input tokens, "
          f"~${tokens / 1e6 * judge.PRICE_PER_MTOK:.5f}, model {', '.join(sorted(models))}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = {"at": stamp, "models": sorted(models), "input_tokens": tokens,
           "pick": None if not pick else {
               "addr": pick["row"]["addr"], "ticker": pick["row"]["ticker"],
               "price_usd": pick["row"]["price_usd"], "via": pick["via"],
               "confidence": pick["confidence"], "worth": pick["worth"],
               "size_factor": NO_SOCIAL_CUT, "runner_up": pick.get("runner_up")},
           "no_trade_reason": reason,
           "judged": [{k: v for k, v in r.items() if k != "dossier"} for r in judged]}
    for name in (f"judged-{stamp}.json", "judged-latest.json"):
        (RUNS / name).write_text(json.dumps(out, indent=2, default=str))
    print(f"saved runs/judged-{stamp}.json")


if __name__ == "__main__":
    main()
