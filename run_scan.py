"""Phase 2: one scan, no AI, no trading. Prints the funnel and what survived.

    python run_scan.py                  normal run
    python run_scan.py --verbose        also print every token's numbers and fate
    python run_scan.py --ignore-bench   re-check benched tokens (for testing)
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))   # before sources reads SOLANA_RPC_URL

import db                                         # noqa: E402
import sources                                    # noqa: E402
from collect import from_pools, add_dossier       # noqa: E402
from filter import market_kill, chain_kill        # noqa: E402
from thresholds import (NEW_POOL_PAGES, TRENDING_PAGES, MAX_DOSSIERS,  # noqa: E402
                        MULTI_BATCH, MAX_MARKET_CALLS, STALE_HOURS)

# failures that won't fix themselves on an old token: stop watching it entirely
STALE_REASONS = {"liquidity", "volume", "trades", "mcap", "bonding_curve", "no_pair"}


def money(x):
    if x is None:
        return "?"
    return f"${x / 1e6:.2f}M" if x >= 1e6 else f"${x / 1e3:.0f}k"


def pct(x):
    return "?" if x is None else f"{x * 100:.1f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--ignore-bench", action="store_true")
    args = ap.parse_args()

    # 0. Universe: discover tokens and remember them across runs
    new = db.watch(sources.new_pools(NEW_POOL_PAGES), "new_pools")
    new += db.watch(sources.trending_pools(TRENDING_PAGES), "trending")
    pruned = db.prune()
    watch = db.watched()
    print(f"watchlist: {len(watch)} tokens ({new} new this run, {pruned} aged out)")

    # 1. Market pass: one GeckoTerminal call per 30 tokens, newest first, capped
    todo = [w for w in watch if args.ignore_bench or not db.benched(w["addr"])]
    todo = todo[:MAX_MARKET_CALLS * MULTI_BATCH]
    pools = sources.token_pools([w["addr"] for w in todo])
    kills, survivors, dexes, dropped = Counter(), [], Counter(), 0
    for w in todo:
        t = from_pools(w["addr"], w["symbol"], pools[w["addr"]], w["first_seen"])
        k = "no_pair" if t is None else market_kill(t)
        if t is not None:
            dexes[t["dex"]] += 1
        if args.verbose and t is not None:
            print(f"  {t['ticker'][:12]:<12} {str(t['dex'])[:14]:<14} "
                  f"age {t['age_minutes'] or 0:>6.0f}m  liq {money(t['liquidity_usd']):>7} "
                  f"vol {money(t['volume_h24']):>7}  mcap {money(t['mcap_usd']):>7}  "
                  f"trades {t['trades_h24'] or 0:>5}  -> {k or 'PASS'}")
        if k:
            kills[k] += 1
            age = t["age_minutes"] if t else None
            if k in STALE_REASONS and (age is None or age > STALE_HOURS * 60):
                db.drop(w["addr"])
                dropped += 1
            elif k != "too_young":
                db.sit(w["addr"], k)
            continue
        survivors.append(t)

    print(f"market pass: {len(todo)} checked, {len(survivors)} survived "
          f"({len(watch) - len(todo)} benched or over the per-run cap, "
          f"{dropped} stale tokens dropped)")
    for reason, n in kills.most_common():
        print(f"   killed by {reason:<14} {n}")
    print(f"   pools by dex: {dict(dexes.most_common())}")

    # 2. Dossier pass: the best candidates by turnover get GT info + RPC holders
    survivors.sort(key=lambda t: (t["volume_h24"] or 0) / max(t["mcap_usd"] or 1, 1),
                   reverse=True)
    finalists, chain_kills = [], Counter()
    for t in survivors[:MAX_DOSSIERS]:
        try:
            info = sources.gt_token_info(t["addr"])
        except Exception as e:
            print(f"   dossier failed for {t['ticker']}: {e}")
            db.sit(t["addr"], "dossier_failed")
            continue
        try:
            conc = sources.wallet_concentration(t["addr"])
        except Exception as e:
            print(f"   holder lookup failed for {t['ticker']}: {e} (kept as unknown)")
            conc = None
        d = add_dossier(t, info, conc)
        k = chain_kill(d)
        print(f"   {d['ticker']:<12} mint {d['mint_authority']}/freeze {d['freeze_authority']}"
              f"  top wallet {pct(d['top_wallet_pct'])}  top10 {pct(d['top_10_pct'])}"
              f"  pools {pct(d['pool_pct'])}  holders {d['holder_count'] or '?'}"
              f"  -> {k or 'PASS'}")
        if k:
            chain_kills[k] += 1
            db.sit(d["addr"], k)
            continue
        finalists.append(d)

    waiting = len(survivors) - MAX_DOSSIERS
    print(f"chain pass: {min(len(survivors), MAX_DOSSIERS)} checked, "
          f"{len(finalists)} survived"
          + (f" ({waiting} waiting for a dossier slot)" if waiting > 0 else ""))
    for reason, n in chain_kills.most_common():
        print(f"   killed by {reason:<14} {n}")

    # 3. Hand-off for Phase 3: these are what Jev will judge
    out = Path(__file__).with_name("runs")
    out.mkdir(exist_ok=True)
    (out / "latest.json").write_text(json.dumps(finalists, indent=2, default=str))
    print(f"\n{len(finalists)} finalist(s) written to runs/latest.json")
    for d in finalists:
        print(f"  {d['ticker']:<12} {d['addr']}\n"
              f"     age {d['age_minutes']:.0f}m  liq {money(d['liquidity_usd'])}  "
              f"mcap {money(d['mcap_usd'])}  vol24 {money(d['volume_h24'])}  "
              f"buys/sells 1h {d['buys_h1']}/{d['sells_h1']}  "
              f"X: {d['x_handle'] or 'none'}")


if __name__ == "__main__":
    main()
