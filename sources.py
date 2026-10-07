"""Thin clients for the free data sources. Nothing here decides anything."""

import os
import time
import requests

from solana_util import is_on_curve
from thresholds import GT_PER_MINUTE, DEX_BATCH

GT = "https://api.geckoterminal.com/api/v2"
DEX = "https://api.dexscreener.com/latest/dex/tokens"
RPC = os.environ.get("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
HEADERS = {"Accept": "application/json", "User-Agent": "jev-desk/0.1"}


class Limiter:
    """Spaces calls so we never exceed `per_minute`. Sleeping is cheap; 429s are not."""

    def __init__(self, per_minute: int):
        self.gap = 60.0 / per_minute
        self.last = 0.0

    def wait(self):
        delay = self.last + self.gap - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self.last = time.monotonic()


gt_limit = Limiter(GT_PER_MINUTE)


def _gt(path: str, **params) -> dict:
    gt_limit.wait()
    r = requests.get(f"{GT}{path}", params=params, headers=HEADERS, timeout=20)
    if r.status_code == 429:                       # back off a full minute, retry once
        time.sleep(60)
        gt_limit.wait()
        r = requests.get(f"{GT}{path}", params=params, headers=HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


# --- Universe: where candidates come from ------------------------------------

def _base_tokens(resp: dict) -> list[dict]:
    out = []
    for pool in resp.get("data", []):
        rel = (pool.get("relationships") or {}).get("base_token") or {}
        gid = (rel.get("data") or {}).get("id") or ""
        if not gid.startswith("solana_"):
            continue
        name = (pool.get("attributes") or {}).get("name", "")
        out.append({"addr": gid.split("_", 1)[1], "symbol": name.split(" / ")[0]})
    return out


def new_pools(pages: int) -> list[dict]:
    found = []
    for page in range(1, pages + 1):
        found += _base_tokens(_gt("/networks/solana/new_pools", page=page))
    return found


def trending_pools(pages: int) -> list[dict]:
    found = []
    for page in range(1, pages + 1):
        found += _base_tokens(_gt("/networks/solana/trending_pools", page=page))
    return found


# --- Market data: DexScreener, up to 30 tokens per call ----------------------

def dex_pairs(addrs: list[str]) -> dict[str, list[dict]]:
    """addr -> every pair where that token is the BASE token."""
    out: dict[str, list[dict]] = {a: [] for a in addrs}
    for i in range(0, len(addrs), DEX_BATCH):
        chunk = addrs[i:i + DEX_BATCH]
        r = requests.get(f"{DEX}/{','.join(chunk)}", headers=HEADERS, timeout=20)
        r.raise_for_status()
        for p in r.json().get("pairs") or []:
            if p.get("chainId") != "solana":
                continue
            base = (p.get("baseToken") or {}).get("address")
            if base in out:
                out[base].append(p)
        time.sleep(0.3)                            # DexScreener allows ~300/min; be polite
    return out


# --- Dossier: GeckoTerminal token info + Solana RPC holder concentration -----

def gt_token_info(addr: str) -> dict:
    return _gt(f"/networks/solana/tokens/{addr}/info")["data"]["attributes"]


def _rpc(method: str, params: list):
    r = requests.post(RPC, json={"jsonrpc": "2.0", "id": 1, "method": method,
                                 "params": params}, headers=HEADERS, timeout=20)
    r.raise_for_status()
    body = r.json()
    if "error" in body:
        raise RuntimeError(f"{method}: {body['error'].get('message')}")
    return body["result"]


def wallet_concentration(mint: str) -> dict:
    """Share of supply held by the largest REAL wallets.

    getTokenLargestAccounts returns token accounts, not people. We look up who owns
    each one and drop owners that are off-curve (pools, bonding curves, lockers),
    then sum by owner, since one person can hold several token accounts."""
    supply = float(_rpc("getTokenSupply", [mint])["value"]["amount"])
    top = _rpc("getTokenLargestAccounts", [mint])["value"]
    if not supply or not top:
        return {"top_wallet_pct": None, "top_10_pct": None, "pool_pct": None}

    accounts = _rpc("getMultipleAccounts",
                    [[a["address"] for a in top], {"encoding": "jsonParsed"}])["value"]
    by_owner: dict[str, float] = {}
    pooled = 0.0
    for acct, info in zip(top, accounts):
        amount = float(acct["amount"])
        owner = (((info or {}).get("data") or {}).get("parsed") or {}) \
            .get("info", {}).get("owner")
        if not owner or not is_on_curve(owner):
            pooled += amount                       # program-owned: pool, curve, locker
            continue
        by_owner[owner] = by_owner.get(owner, 0.0) + amount

    wallets = sorted(by_owner.values(), reverse=True)
    return {"top_wallet_pct": wallets[0] / supply if wallets else 0.0,
            "top_10_pct": sum(wallets[:10]) / supply if wallets else 0.0,
            "pool_pct": pooled / supply}
