"""Plain-fact checks. Each returns the name of the check that failed, or None.
Facts kill before judgements do: nothing here needs a model."""

from thresholds import HARD, BONDING_DEXES, SOFT, SHAPE_MIN_CROWD


def market_kill(t: dict) -> str | None:
    """Pass one. Everything it reads came from the DexScreener batch."""
    if t["dex"] in BONDING_DEXES:
        return "bonding_curve"                     # not a real pool yet
    age = t["age_minutes"]
    if age is None:
        return "no_pair"
    if age < HARD["min_age_minutes"]:
        return "too_young"                         # not benched: it will age
    if age > HARD["max_age_hours"] * 60:
        return "too_old"
    if (t["liquidity_usd"] or 0) < HARD["min_liquidity_usd"]:
        return "liquidity"
    if (t["volume_h24"] or 0) < HARD["min_volume_h24"]:
        return "volume"
    if not HARD["min_mcap_usd"] <= (t["mcap_usd"] or 0) <= HARD["max_mcap_usd"]:
        return "mcap"
    if (t["trades_h24"] or 0) < HARD["min_trades_h24"]:
        return "trades"
    if t["turnover"] is not None and t["turnover"] > HARD["max_turnover"]:
        return "turnover"                          # volume far beyond the token's value
    if t["sells_h1"] == 0 and (t["buys_h1"] or 0) > 20:
        return "no_sells"                          # buys going through, sells are not
    return None


def _open(value) -> bool:
    """GeckoTerminal reports a renounced authority as the string "no".
    None means unknown, which is not the same as open, so it does not kill here."""
    return value is not None and str(value).strip().lower() != "no"


def chain_kill(d: dict) -> str | None:
    """Pass two, after the dossier. Safety facts we couldn't read (authorities, holder
    concentration) reject the token with a short bench; we never trade blind."""
    if _open(d["mint_authority"]) or _open(d["freeze_authority"]):
        return "authority_open"
    if d["mint_authority"] is None or d["freeze_authority"] is None:
        return "authority_unknown"                 # never trade a mint we couldn't read
    if d["top_wallet_pct"] is None:
        return "holders_unknown"                   # RPC holder lookup failed
    if d["top_wallet_pct"] is not None and d["top_wallet_pct"] > HARD["max_top_wallet"]:
        return "top_wallet"
    top10 = d["top_10_pct"] if d["top_10_pct"] is not None else d["gt_top_10_pct"]
    if top10 is not None and top10 > HARD["max_top_10"]:
        return "top_10"
    if d["holder_count"] is not None and d["holder_count"] < HARD["min_holders"]:
        return "holders"
    return None


def judge_kill(ans: dict) -> str | None:
    """Pass three: Jev's answers against SOFT in thresholds.py. First failure wins.
    A question that wasn't answered fails too: missing is missing, not a pass."""
    for name, (direction, limit) in SOFT.items():
        a = ans.get(name)
        if a is None:
            return f"{name}_missing"
        v = a.get("noul", a.get("score"))
        if v is None:
            return f"{name}_missing"
        if direction == "max" and v > limit:
            return name
        if direction == "min" and v < limit:
            return name

    shape = ans.get("shape")
    if shape is None:
        return "shape_missing"
    if shape.get("choice") in ("fading", "one_buyer", "too_early"):
        return f"shape_{shape['choice']}"
    if (shape.get("probabilities") or {}).get("crowd", 0) < SHAPE_MIN_CROWD:
        return "shape_weak"
    return None
