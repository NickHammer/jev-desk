"""Turns raw API responses into the desk's own field names, once, here.
Every file downstream reads these names and only these."""

import time
from datetime import datetime


def _num(x):
    """APIs send numbers as numbers, strings, or null. Null stays None, never 0."""
    if x is None or x == "":
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _epoch(iso):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def from_pools(addr: str, symbol: str, pools: list[dict],
               first_seen: float | None = None) -> dict | None:
    """One token from its GeckoTerminal top pools. None if it has no pools at all.
    The deepest pool supplies the numbers; the earliest pool dates the launch."""
    if not pools:
        return None
    best = max(pools, key=lambda p: _num((p.get("attributes") or {})
                                         .get("reserve_in_usd")) or 0)
    a = best.get("attributes") or {}
    txns = a.get("transactions") or {}
    vol = a.get("volume_usd") or {}
    chg = a.get("price_change_percentage") or {}

    def tx(window, side):
        return (txns.get(window) or {}).get(side)

    created = [e for p in pools
               if (e := _epoch((p.get("attributes") or {}).get("pool_created_at")))]
    starts = created + ([first_seen] if first_seen else [])
    buys_h24, sells_h24 = tx("h24", "buys"), tx("h24", "sells")
    mcap = _num(a.get("market_cap_usd")) or _num(a.get("fdv_usd"))
    vol24 = _num(vol.get("h24"))
    return {
        "addr": addr,
        "ticker": symbol or (a.get("name") or "?").split(" / ")[0],
        "dex": best.get("dex_id"),
        "pool_addr": a.get("address"),
        "price_usd": _num(a.get("base_token_price_usd")),
        "liquidity_usd": _num(a.get("reserve_in_usd")),
        "mcap_usd": mcap,
        "volume_h24": vol24,
        "volume_h6": _num(vol.get("h6")),
        "volume_h1": _num(vol.get("h1")),
        "buys_h1": tx("h1", "buys"), "sells_h1": tx("h1", "sells"),
        "buys_h6": tx("h6", "buys"), "sells_h6": tx("h6", "sells"),
        # distinct wallets, not trades: recorded as attention signals (signals.py)
        "buyers_h1": tx("h1", "buyers"), "sellers_h1": tx("h1", "sellers"),
        "buyers_h6": tx("h6", "buyers"), "sellers_h6": tx("h6", "sellers"),
        "trades_h24": (buys_h24 or 0) + (sells_h24 or 0)
                      if buys_h24 is not None or sells_h24 is not None else None,
        "change": {w: _num(chg.get(w)) for w in ("m5", "h1", "h6", "h24")},
        # how many times its own value changed hands today; very high = likely wash trading
        "turnover": vol24 / mcap if vol24 is not None and mcap else None,
        # the earliest evidence of the token: its first pool, or when we first saw it
        "age_minutes": (time.time() - min(starts)) / 60 if starts else None,
    }


def add_dossier(t: dict, info: dict, conc: dict | None,
                auth: dict | None = None) -> dict:
    """Merge GeckoTerminal token info and RPC concentration into the token."""
    holders = info.get("holders") or {}
    dist = holders.get("distribution_percentage") or {}
    return {**t,
            "name": info.get("name"),
            # GeckoTerminal says "no" when renounced: a string, not null.
            # Anything else ("yes", an address, None) is kept as-is for the check.
            # The chain (auth) wins; GeckoTerminal is the fallback.
            "mint_authority": (auth or {}).get("mint_authority", info.get("mint_authority")),
            "freeze_authority": (auth or {}).get("freeze_authority",
                                                 info.get("freeze_authority")),
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
    if h.lower() in {"i", "home", "search", "intent", "share"}:
        return None                                # x.com/i/communities/... is not an account
    return h if h and h.replace("_", "").isalnum() and len(h) <= 15 else None
