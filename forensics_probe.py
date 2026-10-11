"""Forensics probe (plan step 0): checks, on a few real tokens, that the chain lookups
the forensics signals need actually work through your RPC, and measures how many
calls each one costs. Read-only: it changes nothing and isn't part of a cycle.

    .venv/bin/python forensics_probe.py              5 recently tracked tokens from desk.db
    .venv/bin/python forensics_probe.py MINT [MINT]  specific tokens

What it tries, per token:
  1. creation    page back through the mint's history to its first transaction;
                 the fee payer of that transaction is the deployer
  2. deployer    how old the deployer wallet is and how active (capped)
  3. launches    how many of the deployer's recent transactions created a new token
  4. buyers      the first distinct wallets whose balance of this token went up
  5. funding     for each early buyer: which wallet first sent it SOL, and when
  6. holding     whether those early buyers still hold the token
"""

import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))   # before sources reads SOLANA_RPC_URL

import db                                       # noqa: E402
import sources                                  # noqa: E402

MAX_PAGES = 40          # 1000 signatures per page; a busier token is reported as "too busy"
FIRST_TXS = 60          # earliest transactions to read when looking for first buyers
FIRST_BUYERS = 15
WALLET_PAGES = 3        # pages back through a buyer's history to find its funding
DEPLOYER_SAMPLE = 30    # deployer transactions read to look for other launches
calls = Counter()
step = "setup"


def rpc(method, params):
    calls[step] += 1
    return sources._rpc(method, params)


def oldest_signatures(addr, max_pages):
    """Walk back to the oldest signatures of an address. Returns (oldest page, pages, hit cap)."""
    before, page, pages = None, [], 0
    while pages < max_pages:
        opts = {"limit": 1000, **({"before": before} if before else {})}
        res = rpc("getSignaturesForAddress", [addr, opts])
        pages += 1
        if not res:
            break
        page = res
        if len(res) < 1000:
            return page, pages, False
        before = res[-1]["signature"]
    return page, pages, True


def tx(sig):
    return rpc("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}])


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
        if b.get("mint") != mint:
            continue
        key = (b.get("owner"), b.get("accountIndex"))
        if float(b["uiTokenAmount"]["amount"]) > pre.get(key, 0.0) and b.get("owner"):
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
            m = (p.get("info") or {}).get("mint")
            if m:
                found.add(m)
    return found


def probe(mint, ticker="?"):
    global step
    t0 = time.time()
    calls.clear()
    print(f"\n=== {ticker}  {mint}")

    step = "creation"
    page, pages, capped = oldest_signatures(mint, MAX_PAGES)
    if capped:
        print(f"  creation: more than {MAX_PAGES * 1000:,} transactions, too busy to page back; skipped")
        return {"mint": mint, "ok": False, "calls": dict(calls)}
    if not page:
        print("  creation: no history found")
        return {"mint": mint, "ok": False, "calls": dict(calls)}
    first = page[-1]
    ct = tx(first["signature"]) or {}
    deployer = fee_payer(ct)
    made = created_mints(ct)
    launched = time.strftime("%Y-%m-%d %H:%M", time.localtime(first.get("blockTime") or 0))
    print(f"  creation: {pages} page(s); first tx {launched}; deployer {deployer}; "
          f"mint created in that tx: {'yes' if mint in made else 'NO (deployer may be wrong)'}")

    step = "deployer"
    dpage, dpages, dcap = oldest_signatures(deployer, 5) if deployer else ([], 0, False)
    if dpage:
        born = dpage[-1].get("blockTime") or 0
        age_h = ((first.get("blockTime") or 0) - born) / 3600
        print(f"  deployer: {dpages} page(s){' (capped, older than shown)' if dcap else ''}; "
              f"wallet was {age_h:,.1f} h old at launch; ≥{(dpages - 1) * 1000 + len(dpage):,} txs total")

    step = "launches"
    recent = rpc("getSignaturesForAddress", [deployer, {"limit": DEPLOYER_SAMPLE}]) if deployer else []
    other = set()
    for s in recent:
        other |= created_mints(tx(s["signature"]) or {})
    other.discard(mint)
    print(f"  launches: {len(other)} other token(s) created in the deployer's last {len(recent)} txs"
          + (f": {', '.join(sorted(other)[:3])}{'…' if len(other) > 3 else ''}" if other else ""))

    step = "buyers"
    earliest = list(reversed(page))[:FIRST_TXS]
    buyers, buy_time = [], {}
    for s in earliest:
        for owner in token_gainers(tx(s["signature"]) or {}, mint):
            if owner not in buy_time and owner != deployer and sources.is_on_curve(owner):
                buy_time[owner] = s.get("blockTime") or 0
                buyers.append(owner)
        if len(buyers) >= FIRST_BUYERS:
            break
    print(f"  buyers: {len(buyers)} distinct early buyer wallet(s) from the first {len(earliest)} txs")

    step = "funding"
    funder, fresh = {}, 0
    for b in buyers:
        bpage, _, bcap = oldest_signatures(b, WALLET_PAGES)
        if not bpage or bcap:                         # a very active wallet: old, not fresh
            funder[b] = "(old, busy wallet)"
            continue
        ft = tx(bpage[-1]["signature"]) or {}
        src = fee_payer(ft)
        funder[b] = src if src != b else "(self)"
        born = bpage[-1].get("blockTime") or 0
        if buy_time[b] - born < 86400:
            fresh += 1
    groups = Counter(f for f in funder.values() if f not in (None, "(self)", "(old, busy wallet)"))
    top_src, top_n = groups.most_common(1)[0] if groups else (None, 0)
    funded_by_deployer = sum(1 for f in funder.values() if f == deployer)
    print(f"  funding: {len(funder)} traced; biggest shared funder covers {top_n} of {len(buyers)} "
          f"({top_src}); funded by the deployer: {funded_by_deployer}; "
          f"fresh wallets (<24h old at buy): {fresh}")

    step = "holding"
    still = 0
    for b in buyers:
        res = rpc("getTokenAccountsByOwner", [b, {"mint": mint}, {"encoding": "jsonParsed"}])
        amt = sum(float(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"])
                  for a in (res or {}).get("value") or [])
        still += amt > 0
    print(f"  holding: {still} of {len(buyers)} early buyers still hold it")

    total = sum(calls.values())
    print(f"  CALLS: {dict(calls)}  total {total}  in {time.time() - t0:.0f}s")
    return {"mint": mint, "ok": True, "calls": dict(calls), "total": total}


def main():
    mints = [(m, "?") for m in sys.argv[1:]]
    if not mints:
        rows = sorted(db.tracked_rows(), key=lambda r: -r["judged_at"])
        seen = []
        for r in rows:
            if r["addr"] not in [m for m, _ in seen]:
                seen.append((r["addr"], r["ticker"]))
            if len(seen) == 5:
                break
        mints = seen
    if not mints:
        raise SystemExit("No tracked tokens yet; pass mint addresses instead.")
    print(f"probing {len(mints)} token(s) through {sources.RPC.split('?')[0]} "
          f"(paced at {sources.RPC_PER_MINUTE}/min)")
    results = [probe(m, t) for m, t in mints]
    ok = [r for r in results if r["ok"]]
    if ok:
        per = defaultdict(list)
        for r in ok:
            for k, v in r["calls"].items():
                per[k].append(v)
        print("\nSUMMARY  average calls per token: "
              + ", ".join(f"{k} {sum(v) / len(v):.0f}" for k, v in per.items())
              + f"  ->  total {sum(r['total'] for r in ok) / len(ok):.0f}")
    print("Paste this whole output back to Claude.")


if __name__ == "__main__":
    main()
