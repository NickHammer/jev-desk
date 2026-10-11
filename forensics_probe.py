"""Forensics probe: runs the chain-forensics lookups (forensics.py) on a few tokens
and prints every step and its RPC call count. Read-only and not part of a cycle: it
doesn't save anything.

    .venv/bin/python forensics_probe.py              5 recently tracked tokens from desk.db
    .venv/bin/python forensics_probe.py MINT [MINT]  specific tokens
"""

import sys
import time
from collections import defaultdict

import db
import forensics as F
import sources


def main():
    mints = [(m, "?") for m in sys.argv[1:]]
    if not mints:
        seen = []
        for r in sorted(db.tracked_rows(), key=lambda r: -r["judged_at"]):
            if r["addr"] not in [m for m, _ in seen]:
                seen.append((r["addr"], r["ticker"]))
            if len(seen) == 5:
                break
        mints = seen
    if not mints:
        raise SystemExit("No tracked tokens yet; pass mint addresses instead.")
    print(f"probing {len(mints)} token(s) through {sources.RPC.split('?')[0]} "
          f"(paced at {sources.RPC_PER_MINUTE}/min)")
    per, ok = defaultdict(list), 0
    for mint, ticker in mints:
        F.calls.clear()
        t0 = time.time()
        print(f"\n=== {ticker}  {mint}")
        try:
            status, data, _ = F.investigate(mint, print)
        except Exception as e:                        # one bad token mustn't stop the probe
            print(f"  FAILED: {str(e)[:160]}")
            continue
        total = sum(F.calls.values())
        print(f"  status {status}; CALLS: {dict(F.calls)}  total {total}  in {time.time() - t0:.0f}s")
        if status == "ok":
            ok += 1
            for k, v in F.calls.items():
                per[k].append(v)
    if ok:
        print("\nSUMMARY  average calls per token: "
              + ", ".join(f"{k} {sum(v) / len(v):.0f}" for k, v in per.items())
              + f"  ->  total {sum(sum(v) for v in per.values()) / ok:.0f}")
    print(f"transaction format asked for: version {F.TX_VERSION[0]}")
    if F.errors:
        print("unreadable transactions: " + "; ".join(f"{n}x {e}" for e, n in F.errors.most_common(3)))


if __name__ == "__main__":
    main()
