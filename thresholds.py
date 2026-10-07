"""Every tunable number lives here. When you retune the desk, edit this file only."""

# --- Market checks (from DexScreener; cheap, run on every watched token) -----
HARD = {
    "min_age_minutes":   15,         # younger than this and the data is noise
    "max_age_hours":     72,         # older than this and it is not a launch any more
    "min_liquidity_usd": 12_000,
    "min_volume_h24":    40_000,
    "min_mcap_usd":      60_000,
    "max_mcap_usd":      8_000_000,
    "min_trades_h24":    150,
    # --- Chain checks (from GeckoTerminal + Solana RPC; one dossier per token) ---
    "max_top_wallet":    0.05,       # largest real wallet's share of supply (pools excluded)
    "max_top_10":        0.60,       # top 10 real wallets' combined share
    "min_holders":       80,         # only applied when GeckoTerminal reports a count
}

# GeckoTerminal dex ids that mean "still on a launchpad bonding curve, not a real pool yet".
# run_scan.py prints every dex id it sees, so this list can grow from real data.
BONDING_DEXES = {"pump-fun", "pumpfun", "moonshot", "raydium-launchlab", "launchlab",
                 "bonk-fun", "meteora-dbc"}

# --- Budgets -----------------------------------------------------------------
GT_PER_MINUTE  = 10   # GeckoTerminal free tier; the limiter paces every GT call to this
NEW_POOL_PAGES = 2    # pages of new_pools per run (~20 pools per page)
TRENDING_PAGES = 1    # pages of trending_pools per run, so the watchlist is never empty
MAX_DOSSIERS   = 6    # GT info + RPC checks per run, best candidates first
RPC_PER_MINUTE = 20   # Solana RPC pacing; raise to ~300 with a private RPC URL (e.g. Helius)
MULTI_BATCH    = 30   # tokens per GeckoTerminal tokens/multi call (its maximum)
MAX_MARKET_CALLS = 10 # cap on market-pass GT calls per run (300 tokens), newest first
STALE_HOURS    = 6    # a token still failing liquidity/volume after this long is dropped

# --- How long a rejection stands, by the check that fired (minutes) -----------
BENCH_MINUTES = {
    # facts that will not change while the token exists
    "authority_open": 100_000, "authority_unknown": 20, "top_wallet": 100_000, "too_old": 100_000,
    # can change as the float moves
    "top_10": 90, "holders": 90,
    # can change inside the hour; keep short or you miss the token maturing
    "liquidity": 25, "volume": 25, "mcap": 25, "trades": 25, "no_sells": 25,
    "bonding_curve": 15, "no_pair": 10, "dossier_failed": 20,
}
DEFAULT_BENCH = 45
