"""Attention signals: free numbers recorded with every tracked token (judged and
control) so we can later test whether they predict anything. They never decide a
verdict; the settings stamp is unaffected.

    python signals.py          the report: does each signal separate winners from losers?

Signals
    vol_accel        last hour's volume / the 6-hour hourly pace (>1 = speeding up)
    buy_accel        last hour's buys / the 6-hour hourly pace
    buyers_accel     last hour's distinct buyers / the 6-hour hourly pace
    buy_share_1h     buys / (buys + sells) in the last hour
    buyer_share_1h   distinct buyers / (buyers + sellers) in the last hour
    holders          holder count (GeckoTerminal), when known
    holders_per_hour holders / hours since launch
    holder_growth    new holders per hour since our earliest snapshot in the last 6h
                     (needs two snapshots at least 10 minutes apart)
    boosts_active    paid DexScreener boosts active right now
    paid_orders      paid DexScreener orders, e.g. "tokenProfile:approved"
    promoted         any boost or approved order (True/False), None if DexScreener failed
"""

import statistics
import time

import db
import sources


def _ratio(now, window, hours):
    """Last hour against the window's hourly pace; None when there is nothing to compare."""
    if now is None or not window:
        return None
    pace = window / hours
    return round(now / pace, 3) if pace else None


def _share(a, b):
    return round(a / (a + b), 3) if a is not None and b is not None and (a + b) else None


def momentum(t: dict) -> dict:
    return {
        "vol_accel": _ratio(t.get("volume_h1"), t.get("volume_h6"), 6),
        "buy_accel": _ratio(t.get("buys_h1"), t.get("buys_h6"), 6),
        "buyers_accel": _ratio(t.get("buyers_h1"), t.get("buyers_h6"), 6),
        "buy_share_1h": _share(t.get("buys_h1"), t.get("sells_h1")),
        "buyer_share_1h": _share(t.get("buyers_h1"), t.get("sellers_h1")),
    }


def holders(addr: str, count: int | None, age_minutes: float | None) -> dict:
    out = {"holders": count, "holders_per_hour": None, "holder_growth": None}
    if count is None:
        return out
    if age_minutes:
        out["holders_per_hour"] = round(count / (age_minutes / 60), 2)
    hist = [(t, h) for t, h in db.holder_history(addr) if time.time() - t >= 600]
    if hist:
        t0, h0 = hist[0]
        out["holder_growth"] = round((count - h0) / ((time.time() - t0) / 3600), 2)
    return out


def promotion(addrs: list[str]) -> dict[str, dict]:
    """DexScreener boosts and paid orders for these tokens. Any failure gives None
    values (unknown), never False, so a broken lookup can't look like 'not promoted'."""
    unknown = {"boosts_active": None, "paid_orders": None, "promoted": None}
    out = {a: dict(unknown) for a in addrs}
    if not addrs:
        return out
    try:
        boosts = sources.ds_active_boosts(addrs)
    except Exception as e:
        print(f"   DexScreener boosts unavailable: {str(e)[:80]}")
        return out
    for a in addrs:
        try:
            orders = sources.ds_paid_orders(a)
        except Exception:
            orders = None
        approved = orders is not None and any(o.endswith(":approved") for o in orders)
        out[a] = {"boosts_active": boosts.get(a, 0), "paid_orders": orders,
                  "promoted": (boosts.get(a, 0) > 0 or approved) if orders is not None else None}
    return out


def build(t: dict, promo: dict | None = None) -> dict:
    """Every signal for one token dict (pool fields, plus holder_count if known)."""
    return {**momentum(t), **holders(t["addr"], t.get("holder_count"), t.get("age_minutes")),
            **(promo or {"boosts_active": None, "paid_orders": None, "promoted": None})}


# --- the report ------------------------------------------------------------------

NUMERIC = ["vol_accel", "buy_accel", "buyers_accel", "buy_share_1h", "buyer_share_1h",
           "holders", "holders_per_hour", "holder_growth", "boosts_active"]


def report():
    from score import cell, net_return, HEADER, SUB          # noqa: late import, report only
    rows = [r for r in db.tracked_rows() if r.get("signals")]
    print(f"ATTENTION SIGNALS: {len(rows)} tracked token(s) with signals "
          f"({sum(r['verdict'] == 'control' for r in rows)} control, "
          f"{sum(r['verdict'] != 'control' for r in rows)} judged)")
    print("Each signal splits tokens at its median into a high and a low half. A signal is "
          "only interesting if\nthe halves differ a lot, the same way at every checkpoint, "
          "and with 30+ tokens in each half.\n")
    if not rows:
        print("Nothing yet: signals are recorded from the next cycle on.")
        return
    print(f"{'signal':<24}{HEADER}\n{'':<24}{SUB}")

    def show(name, members):
        print(f"{name:<24}" + "".join(
            "  " + cell([v for r in members if (v := net_return(r, cp)) is not None])
            for cp in ("1h", "6h", "24h")))

    for sig in NUMERIC:
        have = [r for r in rows if r["signals"].get(sig) is not None]
        if len(have) < 4:
            print(f"{sig:<24}  (only {len(have)} token(s) have it so far)")
            continue
        mid = statistics.median(r["signals"][sig] for r in have)
        show(f"{sig} > {mid:g}", [r for r in have if r["signals"][sig] > mid])
        show(f"{sig} <= {mid:g}", [r for r in have if r["signals"][sig] <= mid])
    promo = [r for r in rows if r["signals"].get("promoted") is not None]
    if promo:
        show("promoted", [r for r in promo if r["signals"]["promoted"]])
        show("not promoted", [r for r in promo if not r["signals"]["promoted"]])
    else:
        print(f"{'promoted':<24}  (no DexScreener data yet)")


if __name__ == "__main__":
    report()
