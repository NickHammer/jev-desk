"""Turns raw API responses into the desk's own field names, once, here.
Every file downstream reads these names and only these."""

import time


def _num(x):
    """APIs send numbers as numbers, strings, or null. Null stays None, never 0."""
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def from_pairs(addr: str, pairs: list[dict]) -> dict | None:
    """One token from all of its DexScreener pairs. None if it has no pairs at all."""
    if not pairs:
        return None
    best = max(pairs, key=lambda p: _num((p.get("liquidity") or {}).get("usd")) or 0)
    created = [p["pairCreatedAt"] for p in pairs if p.get("pairCreatedAt")]
    txns = best.get("txns") or {}
    vol = best.get("volume") or {}
    chg = best.get("priceChange") or {}

    def tx(window, side):
        return (txns.get(window) or {}).get(side)

    buys_h24, sells_h24 = tx("h24", "buys"), tx("h24", "sells")
    return {
        "addr": addr,
        "ticker": (best.get("baseToken") or {}).get("symbol"),
        "dex": best.get("dexId"),
        "pair_addr": best.get("pairAddress"),
        "price_usd": _num(best.get("priceUsd")),
        "liquidity_usd": _num((best.get("liquidity") or {}).get("usd")),
        "mcap_usd": _num(best.get("marketCap")) or _num(best.get("fdv")),
        "volume_h24": _num(vol.get("h24")),
        "volume_h6": _num(vol.get("h6")),
        "volume_h1": _num(vol.get("h1")),
        "buys_h1": tx("h1", "buys"), "sells_h1": tx("h1", "sells"),
        "buys_h6": tx("h6", "buys"), "sells_h6": tx("h6", "sells"),
        "trades_h24": (buys_h24 or 0) + (sells_h24 or 0)
                      if buys_h24 is not None or sells_h24 is not None else None,
        "change": {w: _num(chg.get(w)) for w in ("m5", "h1", "h6", "h24")},
        # earliest pair is the closest thing to the token's launch time
        "age_minutes": (time.time() - min(created) / 1000) / 60 if created else None,
    }


def add_dossier(t: dict, info: dict, conc: dict | None) -> dict:
    """Merge GeckoTerminal token info and RPC concentration into the token."""
    holders = info.get("holders") or {}
    dist = holders.get("distribution_percentage") or {}
    return {**t,
            "name": info.get("name"),
            # GeckoTerminal says "no" when renounced: a string, not null.
            # Anything else ("yes", an address, None) is kept as-is for the check.
            "mint_authority": info.get("mint_authority"),
            "freeze_authority": info.get("freeze_authority"),
            "is_honeypot": info.get("is_honeypot"),
            "holder_count": holders.get("count"),
            "gt_top_10_pct": (_num(dist.get("top_10")) / 100
                              if _num(dist.get("top_10")) is not None else None),
            "dev_holding_pct": (_num(info.get("developer_holding_percentage")) / 100
                                if _num(info.get("developer_holding_percentage"))
                                is not None else None),
            "gt_score": _num(info.get("gt_score")),
            "graduated": (info.get("launchpad_details") or {}).get("completed"),
            "x_handle": clean_handle(info.get("twitter_handle")),
            "description": info.get("description"),
            "website": (info.get("websites") or [None])[0],
            **(conc or {"top_wallet_pct": None, "top_10_pct": None, "pool_pct": None})}


def clean_handle(h):
    """Handles sometimes arrive as a post URL. Keep the first segment or drop it."""
    if not h:
        return None
    h = h.strip().lstrip("@").split("?")[0]
    h = h.replace("https://", "").replace("x.com/", "").replace("twitter.com/", "")
    h = h.split("/")[0]
    return h if h and h.replace("_", "").isalnum() and len(h) <= 15 else None
