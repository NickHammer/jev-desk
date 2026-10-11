"""The slow desk, step 1: older survivors instead of fresh launches.

Runs every 4 hours (deploy/jev-desk-slow.timer, via run_slow.sh). Tokens 3-30 days old
that still trade a lot, from two places: "alumni" the fast desk tracked 3-30 days ago,
and GeckoTerminal's top Solana pools by 24h volume. Free market and chain checks tuned
for older tokens (SLOW in thresholds.py), then the deepest-liquidity survivors get a
dossier and go to slow_judge.py. Each run also tracks a random control group. Nothing
is traded, and the fast desk's watchlist, bench and settings stamp are untouched.

    python slow_scan.py            one run
    python slow_scan.py --verbose  also print every candidate's numbers and fate
"""

import argparse
import json
import random
import time
import unicodedata
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))   # before sources reads SOLANA_RPC_URL

import db                                         # noqa: E402
import settings_stamp                             # noqa: E402
import signals                                    # noqa: E402
import sources                                    # noqa: E402
from collect import from_pools, add_dossier       # noqa: E402
from filter import _open                          # noqa: E402
from thresholds import (SLOW, SLOW_POOL_PAGES, SLOW_MAX_DOSSIERS, SLOW_CONTROL_PER_RUN,  # noqa: E402
                        SLOW_REJUDGE_HOURS, SLOW_EXCLUDE, BONDING_DEXES, MULTI_BATCH)

RUNS = Path(__file__).with_name("runs")
MAX_ALUMNI = 300          # alumni checked per run (10 GeckoTerminal calls), still-active first

# Look-alike tickers of majors and stablecoins, e.g. "UЅⅮT" spelled with Cyrillic and
# Roman-numeral letters, are impersonation scams: never slow-desk candidates.
LOOKALIKE = str.maketrans("АВСЕНІЈКМОРЅТХУаеорсухіј", "ABCEHIJKMOPSTXYaeopcyxij")
MAJORS = {"USDT", "USDC", "USDG", "PYUSD", "USD1", "SOL", "WSOL", "BTC", "WBTC", "ETH", "WETH"}


def impersonates_major(ticker: str) -> bool:
    raw = str(ticker or "")
    plain = unicodedata.normalize("NFKC", raw).translate(LOOKALIKE).upper()
    return plain in MAJORS and not raw.isascii()


def money(x):
    return "?" if x is None else (f"${x / 1e6:.2f}M" if x >= 1e6 else f"${x / 1e3:.0f}k")


def slow_market_kill(t: dict) -> str | None:
    """Market checks for tokens that survived their launch."""
    if t["dex"] in BONDING_DEXES:
        return "bonding_curve"
    age = t["age_minutes"]
    if age is None:
        return "no_pair"
    if age < SLOW["min_age_days"] * 1440:
        return "too_young"
    if age > SLOW["max_age_days"] * 1440:
        return "too_old"
    if (t["liquidity_usd"] or 0) < SLOW["min_liquidity_usd"]:
        return "liquidity"
    if (t["volume_h24"] or 0) < SLOW["min_volume_h24"]:
        return "volume"
    if not SLOW["min_mcap_usd"] <= (t["mcap_usd"] or 0) <= SLOW["max_mcap_usd"]:
        return "mcap"
    if (t["trades_h24"] or 0) < SLOW["min_trades_h24"]:
        return "trades"
    if t["turnover"] is not None and t["turnover"] > SLOW["max_turnover"]:
        return "turnover"
    return None


def slow_chain_kill(d: dict) -> str | None:
    """Chain checks: the same safety facts as the fast desk, stricter on spread."""
    if _open(d["mint_authority"]) or _open(d["freeze_authority"]):
        return "authority_open"
    if d["mint_authority"] is None or d["freeze_authority"] is None:
        return "authority_unknown"
    if d["top_wallet_pct"] is None:
        return "holders_unknown"
    if d["top_wallet_pct"] > SLOW["max_top_wallet"]:
        return "top_wallet"
    top10 = d["top_10_pct"] if d["top_10_pct"] is not None else d["gt_top_10_pct"]
    if top10 is not None and top10 > SLOW["max_top_10"]:
        return "top_10"
    if d["holder_count"] is None or d["holder_count"] < SLOW["min_holders"]:
        return "holders"
    return None


def alumni() -> list[dict]:
    """Tokens that passed the fast desk's market check 3-30 days ago (every one, not
    only the ones it tracked), still-active first; plus tracked tokens from before that
    list existed."""
    out = db.market_alumni(SLOW["min_age_days"], SLOW["max_age_days"], MAX_ALUMNI)
    seen, now = {a["addr"] for a in out}, time.time()
    for r in sorted(db.tracked_rows(), key=lambda r: -r["judged_at"]):
        if len(out) >= MAX_ALUMNI:
            break
        if r["desk"] == "fast" and r["addr"] not in seen and \
                now - SLOW["max_age_days"] * 86400 <= r["judged_at"] <= now - SLOW["min_age_days"] * 86400 + 3600:
            seen.add(r["addr"])
            out.append({"addr": r["addr"], "symbol": r["ticker"]})
    return out


def recently_judged(hours: float) -> set[str]:
    cutoff = time.time() - hours * 3600
    return {r["addr"] for r in db.tracked_rows()
            if r["desk"] == "slow" and r["verdict"] != "control" and r["judged_at"] > cutoff}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    # 0. Universe: alumni plus today's top pools, without majors and stablecoins
    cands, seen = [], set()
    try:
        top = sources.top_pools(SLOW_POOL_PAGES)
    except Exception as e:                 # alumni alone still make a run
        print(f"   top pools unavailable: {str(e)[:80]}")
        top = []
    for src, toks in (("alumni", alumni()), ("top pools", top)):
        for t in toks:
            if t["addr"] not in seen and t["addr"] not in SLOW_EXCLUDE and not impersonates_major(t["symbol"]):
                seen.add(t["addr"])
                cands.append({**t, "source": src})
    print(f"slow universe: {len(cands)} token(s) "
          f"({sum(c['source'] == 'alumni' for c in cands)} alumni, "
          f"{sum(c['source'] == 'top pools' for c in cands)} from top pools)")

    # 1. Market pass, 30 tokens per GeckoTerminal call
    pools = sources.token_pools([c["addr"] for c in cands])
    kills, survivors = Counter(), []
    for c in cands:
        t = from_pools(c["addr"], c["symbol"], pools.get(c["addr"]) or [], None)
        k = "no_pair" if t is None else slow_market_kill(t)
        if args.verbose and t is not None:
            print(f"  {t['ticker'][:12]:<12} age {(t['age_minutes'] or 0) / 1440:>5.1f}d  "
                  f"liq {money(t['liquidity_usd']):>8}  vol {money(t['volume_h24']):>8}  "
                  f"mcap {money(t['mcap_usd']):>8}  -> {k or 'PASS'}")
        if k:
            kills[k] += 1
            continue
        survivors.append({**t, "source": c["source"]})
    print(f"slow market pass: {len(cands)} checked, {len(survivors)} survived"
          + "".join(f"\n   killed by {r:<14} {n}" for r, n in kills.most_common()))

    # 2. Control group: random market survivors, never judged
    stamp = settings_stamp.current("slow")
    db.remember_settings(stamp, settings_stamp.settings_json("slow"))
    priced = [t for t in survivors if t.get("price_usd")]
    sample = random.sample(priced, min(SLOW_CONTROL_PER_RUN, len(priced)))
    for t in sample:
        try:
            t["holder_count"] = (sources.gt_token_info(t["addr"]).get("holders") or {}).get("count")
            db.record_holders(t["addr"], t["holder_count"])
        except Exception as e:
            print(f"   holder count failed for control {t['ticker']}: {str(e)[:60]}")
    promo = signals.promotion([t["addr"] for t in sample])
    n = db.track([{"addr": t["addr"], "ticker": t["ticker"], "price0": t["price_usd"],
                   "verdict": "control", "fails": [],
                   "signals": signals.build(t, promo.get(t["addr"]))} for t in sample],
                 run=time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()), stamp=stamp, desk="slow")
    print(f"slow control group: {n} random survivor(s) newly tracked")

    # 3. Dossiers for the deepest-liquidity survivors not judged in the last day
    skip = recently_judged(SLOW_REJUDGE_HOURS)
    ranked = sorted((t for t in survivors if t["addr"] not in skip),
                    key=lambda t: t["liquidity_usd"] or 0, reverse=True)
    finalists, chain_kills = [], Counter()
    for t in ranked[:SLOW_MAX_DOSSIERS]:
        try:
            info = sources.gt_token_info(t["addr"])
        except Exception as e:
            print(f"   dossier failed for {t['ticker']}: {str(e)[:80]}")
            continue
        try:
            auth = sources.mint_authorities(t["addr"])
        except Exception:
            auth = None
        try:
            conc = sources.wallet_concentration(t["addr"])
        except Exception:
            conc = None
        d = {**add_dossier(t, info, conc, auth), "source": t["source"]}
        db.record_holders(d["addr"], d.get("holder_count"))
        k = slow_chain_kill(d)
        print(f"   {d['ticker'][:12]:<12} {d['source']:<9} holders {d['holder_count'] or '?'}  "
              f"top wallet {d['top_wallet_pct'] if d['top_wallet_pct'] is None else round(d['top_wallet_pct'] * 100, 1)}%"
              f"  -> {k or 'PASS'}")
        if k:
            chain_kills[k] += 1
            continue
        finalists.append(d)
    RUNS.mkdir(exist_ok=True)
    (RUNS / "slow-latest.json").write_text(json.dumps(finalists, indent=2, default=str))
    print(f"slow chain pass: {min(len(ranked), SLOW_MAX_DOSSIERS)} checked, {len(finalists)} "
          f"finalist(s) written to runs/slow-latest.json"
          + (f" ({len(skip)} judged in the last {SLOW_REJUDGE_HOURS}h skipped)" if skip else ""))


if __name__ == "__main__":
    main()
