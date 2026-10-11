"""Chain forensics: who launched a token, and who bought it first.

Runs as the last step of each cycle (run_all.sh). It investigates up to MAX_PER_CYCLE
recently tracked tokens (judged and control alike), newest first, within a time
limit, and caches each result for good, since a token's launch never changes. The
results are signals only: they never decide a verdict and the settings stamp ignores
them. `python signals.py` reports them next to the other signals.

    python forensics.py               one pass, as in a cycle
    python forensics.py --verbose     the same, printing each token's details

Per token, from the chain (Solana RPC, about 120 calls):
    deployer         fee payer of the token's first transaction
    deployer_age_h   how old the deployer wallet was at launch
    deployer_txs     the deployer's transactions so far (at least; capped at 5,000)
    deployer_launches  other tokens it created in its last 30 transactions
    early_buyers     distinct wallets whose balance of the token rose first (up to ~15)
    same_tx_buyers   the most early buyers seen in one transaction (bundled buying)
    bundle_share     share of early buyers first funded by the same wallet
    fresh_share      share of early buyers whose wallet was under 24h old when it bought
    deployer_funded  early buyers first funded by the deployer itself
    holding_share    share of early buyers that still hold the token
Early buyer wallets are also saved (early_buyers table) for later wallet analysis.
"""

import argparse
import json
import time
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))   # before sources reads SOLANA_RPC_URL

import db                                       # noqa: E402
import sources                                  # noqa: E402

MAX_PER_CYCLE = 4       # tokens investigated per cycle
TIME_BUDGET_S = 150     # stop starting new tokens after this many seconds
RECENT_HOURS = 6        # only tokens tracked this recently are worth investigating
MAX_ATTEMPTS = 3        # a token that keeps failing is given up after this many tries
MAX_PAGES = 40          # 1000 signatures per page; busier tokens are "too_busy"
FIRST_TXS = 120         # earliest transactions read when looking for first buyers
FIRST_BUYERS = 15
WALLET_PAGES = 3        # pages back through a buyer's history to find its funding
DEPLOYER_PAGES = 5
DEPLOYER_SAMPLE = 30    # deployer transactions read to look for other launches

calls = Counter()       # per step, for the probe and the cycle log
errors = Counter()
step = "setup"
TX_VERSION = [1]        # newest transaction format we ask for; raised if the RPC names a newer one


def rpc(method, params):
    calls[step] += 1
    return sources._rpc(method, params)


def history(addr, max_pages):
    """Walk back to an address's oldest signatures. Returns (oldest-first list of the
    oldest ~2,000 signatures, pages read, hit the cap, signatures seen)."""
    before, pages, last, prev, total = None, 0, [], [], 0
    while pages < max_pages:
        res = rpc("getSignaturesForAddress", [addr, {"limit": 1000, **({"before": before} if before else {})}])
        pages += 1
        if not res:
            break
        prev, last, total = last, res, total + len(res)
        if len(res) < 1000:
            return list(reversed(prev + last)), pages, False, total
        before = res[-1]["signature"]
    return list(reversed(prev + last)), pages, True, total


def tx(sig):
    """One parsed transaction, or {} if it can't be read (counted, never fatal)."""
    for _ in range(3):
        try:
            return rpc("getTransaction", [sig, {"encoding": "jsonParsed",
                                                "maxSupportedTransactionVersion": TX_VERSION[0]}]) or {}
        except RuntimeError as e:
            if "version" in str(e) and "not supported" in str(e):
                TX_VERSION[0] += 1                        # Solana added a newer format: ask for it
                continue
            errors[str(e)[:80]] += 1
            return {}
    errors["transaction version keeps rising"] += 1
    return {}


def fee_payer(t):
    keys = (t.get("transaction") or {}).get("message", {}).get("accountKeys") or []
    return (keys[0].get("pubkey") if isinstance(keys[0], dict) else keys[0]) if keys else None


def token_gainers(t, mint):
    """Owners whose balance of `mint` went up in this transaction."""
    meta = t.get("meta") or {}
    pre = {(b.get("owner"), b.get("accountIndex")): float(b["uiTokenAmount"]["amount"])
           for b in meta.get("preTokenBalances") or [] if b.get("mint") == mint}
    out = []
    for b in meta.get("postTokenBalances") or []:
        if b.get("mint") != mint or not b.get("owner"):
            continue
        if float(b["uiTokenAmount"]["amount"]) > pre.get((b.get("owner"), b.get("accountIndex")), 0.0):
            out.append(b["owner"])
    return out


def created_mints(t):
    """Mints a transaction initialised (InitializeMint / InitializeMint2, also inner)."""
    meta, found = t.get("meta") or {}, set()
    instrs = list((t.get("transaction") or {}).get("message", {}).get("instructions") or [])
    for inner in meta.get("innerInstructions") or []:
        instrs += inner.get("instructions") or []
    for ins in instrs:
        p = ins.get("parsed") if isinstance(ins, dict) else None
        if isinstance(p, dict) and str(p.get("type", "")).startswith("initializeMint"):
            if (m := (p.get("info") or {}).get("mint")):
                found.add(m)
    return found


def investigate(mint: str, say=lambda *_: None) -> tuple[str, dict, list[dict]]:
    """(status, signals, early buyers). status is ok, too_busy or no_history."""
    global step
    step = "creation"
    sigs, pages, capped, _ = history(mint, MAX_PAGES)
    if capped:
        say(f"  creation: more than {MAX_PAGES * 1000:,} transactions, too busy to page back")
        return "too_busy", {}, []
    if not sigs:
        say("  creation: no history found")
        return "no_history", {}, []
    first = sigs[0]
    launched = first.get("blockTime") or 0
    ct = tx(first["signature"])
    deployer = fee_payer(ct)
    out = {"launched_at": launched, "deployer": deployer, "creation_pages": pages,
           "creation_confirmed": mint in created_mints(ct)}
    say(f"  creation: {pages} page(s); first tx {time.strftime('%Y-%m-%d %H:%M', time.localtime(launched))}; "
        f"deployer {deployer}; mint created in that tx: {'yes' if out['creation_confirmed'] else 'NO'}")

    step = "deployer"
    dsigs, _, dcap, dtotal = history(deployer, DEPLOYER_PAGES) if deployer else ([], 0, False, 0)
    if dsigs:
        out["deployer_age_h"] = round((launched - (dsigs[0].get("blockTime") or launched)) / 3600, 2)
        out["deployer_txs"] = dtotal
        out["deployer_txs_capped"] = dcap
        say(f"  deployer: wallet {out['deployer_age_h']:,.1f} h old at launch; "
            f"≥{out['deployer_txs']:,} txs{' (capped)' if dcap else ''}")

    step = "launches"
    recent = rpc("getSignaturesForAddress", [deployer, {"limit": DEPLOYER_SAMPLE}]) if deployer else []
    other = set()
    for s in recent:
        other |= created_mints(tx(s["signature"]))
    other.discard(mint)
    out["deployer_launches"] = len(other)
    say(f"  launches: {len(other)} other token(s) in the deployer's last {len(recent)} txs")

    step = "buyers"
    buyers, bought, per_tx, read = [], {}, 0, 0
    for s in sigs[:FIRST_TXS]:
        read += 1
        fresh_here = 0
        for owner in token_gainers(tx(s["signature"]), mint):
            if owner not in bought and owner != deployer and sources.is_on_curve(owner):
                bought[owner] = s.get("blockTime") or 0
                buyers.append(owner)
                fresh_here += 1
        per_tx = max(per_tx, fresh_here)
        if len(buyers) >= FIRST_BUYERS:
            break
    out["early_buyers"] = len(buyers)
    out["same_tx_buyers"] = per_tx
    say(f"  buyers: {len(buyers)} early buyer(s) from the first {read} txs; up to {per_tx} in one tx")

    step = "funding"
    funder, fresh, rows = {}, 0, []
    for b in buyers:
        bsigs, _, bcap, _ = history(b, WALLET_PAGES)
        if not bsigs or bcap:                          # a very active wallet: old, not fresh
            funder[b], is_fresh = None, False
        else:
            src = fee_payer(tx(bsigs[0]["signature"]))
            funder[b] = src if src != b else None
            is_fresh = bought[b] - (bsigs[0].get("blockTime") or 0) < 86400
        fresh += is_fresh
        rows.append({"wallet": b, "funder": funder[b], "bought_at": bought[b], "fresh": is_fresh})
    groups = Counter(f for f in funder.values() if f)
    top_src, top_n = groups.most_common(1)[0] if groups else (None, 0)
    n = len(buyers) or None
    out.update({"bundle_share": round(top_n / n, 3) if n else None, "top_funder": top_src,
                "fresh_share": round(fresh / n, 3) if n else None,
                "deployer_funded": sum(1 for f in funder.values() if f and f == deployer)})
    say(f"  funding: biggest shared funder covers {top_n} of {len(buyers)}; "
        f"funded by the deployer: {out['deployer_funded']}; fresh wallets: {fresh}")

    step = "holding"
    still = 0
    for r in rows:
        res = rpc("getTokenAccountsByOwner", [r["wallet"], {"mint": mint}, {"encoding": "jsonParsed"}])
        amt = sum(float(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"])
                  for a in (res or {}).get("value") or [])
        r["still_holds"] = amt > 0
        still += amt > 0
    out["holding_share"] = round(still / n, 3) if n else None
    say(f"  holding: {still} of {len(buyers)} early buyers still hold it")
    return "ok", out, rows


def run(verbose=False):
    """One cycle's pass: the newest tracked tokens without forensics, within budget."""
    t0, done = time.time(), []
    for addr, ticker in db.forensics_queue(RECENT_HOURS, MAX_ATTEMPTS, MAX_PER_CYCLE):
        if time.time() - t0 > TIME_BUDGET_S:
            break
        calls.clear()
        say = print if verbose else (lambda *_: None)
        say(f"\n=== {ticker}  {addr}")
        try:
            status, data, buyers = investigate(addr, say)
        except Exception as e:
            status, data, buyers = "failed", {"error": str(e)[:200]}, []
        db.save_forensics(addr, status, data, buyers, sum(calls.values()))
        done.append(f"{ticker} {status} ({sum(calls.values())} calls)")
    print("forensics: " + (", ".join(done) if done else "nothing new to investigate")
          + f" in {time.time() - t0:.0f}s"
          + (f"; unreadable txs: {sum(errors.values())}" if errors else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    run(ap.parse_args().verbose)


if __name__ == "__main__":
    main()
