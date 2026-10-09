"""The only code that talks to Jev. It builds states, asks questions, and returns the
raw answers. It makes no decisions: thresholds live in thresholds.py and are applied
in filter.judge_kill().

Rules carried over from the guide:
- One call per question SET, never one per question (state is billed once per call).
- State is a small named object with only the fields the questions read.
- Answers come back raw, with the exact model version that produced them.
- Arithmetic happens here in code and is passed in as fields.
"""

import os

from typesafe_sdk import (RetryPolicy, TypeSafeClient, TypeSafeBadRequestError,
                          TypeSafeUnprocessableEntityError)

from questions import SETS
from thresholds import JEV_MODEL, SHADOW_BANK_USD, MAX_TICKET_SHARE

PRICE_PER_MTOK = 0.042        # USD per million input tokens; output is free

_client = None


class MalformedQuestion(RuntimeError):
    """A 400/422 from Jev: the question itself is wrong. Never retry; stop the run."""


def client() -> TypeSafeClient:
    global _client
    if _client is None:
        _client = TypeSafeClient(api_key=os.environ["TYPESAFE_API_KEY"], model=JEV_MODEL,
                                 retry=RetryPolicy(max_retries=3))
    return _client


def _plain(obj):
    return obj.model_dump() if hasattr(obj, "model_dump") else obj


def ask(question_set: str, state: dict) -> dict:
    """One call. Returns {"model", "answers": {name: {...}}, "usage": {...}}."""
    qs = SETS[question_set]
    qs = qs(state) if callable(qs) else qs
    try:
        r = client().system_one(state=state, questions=qs)
    except (TypeSafeUnprocessableEntityError, TypeSafeBadRequestError) as e:
        raise MalformedQuestion(f"{question_set}: {e}") from e
    r = _plain(r)
    return {"model": r.get("model"),
            "answers": {k: _plain(v) for k, v in (r.get("answers") or {}).items()},
            "usage": _plain(r.get("usage")) or {}}


# --- State builders: arithmetic in code, judgement in Jev ---------------------

def _r(x, nd=2):
    return None if x is None else round(x, nd)


def _pct(share):
    """0.025 -> 2.5 (percent). Jev reads percents more naturally than fractions."""
    return None if share is None else round(share * 100, 2)


def ticket_usd() -> float:
    return SHADOW_BANK_USD * MAX_TICKET_SHARE


def market_state(d: dict) -> dict:
    liq, vol24, trades = d.get("liquidity_usd"), d.get("volume_h24"), d.get("trades_h24")
    holders = d.get("holder_count")
    ticket = ticket_usd()
    return {
        "ticker": d.get("ticker"),
        "age_minutes": _r(d.get("age_minutes"), 0),
        "liquidity_usd": _r(liq, 0),
        "mcap_usd": _r(d.get("mcap_usd"), 0),
        "volume_last_1h": _r(d.get("volume_h1"), 0),
        "avg_hourly_volume_6h": _r((d.get("volume_h6") or 0) / 6, 0),
        "avg_hourly_volume_24h": _r((vol24 or 0) / 24, 0),
        "buys_1h": d.get("buys_h1"), "sells_1h": d.get("sells_h1"),
        "buys_6h": d.get("buys_h6"), "sells_6h": d.get("sells_h6"),
        "trades_24h": trades,
        "change_percent": {k: _r(v) for k, v in (d.get("change") or {}).items()},
        "holder_count": holders,
        "intended_ticket_usd": _r(ticket, 0),
        "ticket_percent_of_liquidity": _r(ticket / liq * 100, 3) if liq else None,
        "turnover": _r(d.get("turnover")),
        "avg_trade_usd": _r(vol24 / trades, 0) if vol24 and trades else None,
        "trades_per_holder": _r(trades / holders) if trades and holders else None,
        "top_wallet_percent": _pct(d.get("top_wallet_pct")),
        "top_10_percent": _pct(d.get("top_10_pct") if d.get("top_10_pct") is not None
                               else d.get("gt_top_10_pct")),
        "dev_holding_percent": _pct(d.get("dev_holding_pct")),
    }


def project_state(d: dict) -> dict:
    desc = (d.get("description") or "").strip()
    return {"ticker": d.get("ticker"), "name": d.get("name"),
            "description": desc[:600] or None,
            "website": d.get("website"), "x_handle": d.get("x_handle")}


def candidate_key(d: dict) -> str:
    """Tickers repeat (there were five 'Alpha's in one scan), so keys carry the address."""
    return f"{d.get('ticker') or '?'}_{d['addr'][:4]}"


def summary(d: dict, ans: dict) -> str:
    """Two lines per candidate, built from answers Jev already gave. Never the dossier."""
    def n(name):
        a = ans.get(name) or {}
        return a.get("noul", a.get("score"))

    crowd = ((ans.get("shape") or {}).get("probabilities") or {}).get("crowd")
    return (f"{(d.get('age_minutes') or 0) / 60:.0f}h old, "
            f"${(d.get('mcap_usd') or 0):,.0f} mcap, ${(d.get('liquidity_usd') or 0):,.0f} "
            f"liquidity, {d.get('holder_count') or '?'} holders. "
            f"crowd {crowd or 0:.2f}, wash {n('wash_trading') or 0:.2f}, "
            f"concentration {n('concentration_is_exit_risk') or 0:.2f}, "
            f"momentum spent {n('momentum_already_spent') or 0:.2f}, "
            f"effort {n('effort') or 0:.1f}/3, copycat {n('copycat') or 0:.2f}")


def tokens_used(usages: list[dict]) -> int:
    return sum((u or {}).get("input_tokens", 0) for u in usages)
