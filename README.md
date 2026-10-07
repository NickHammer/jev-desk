# jev-desk

A shadow-mode memecoin scanner for a Raspberry Pi. It watches new Solana launches,
filters them with plain-fact checks, and (from Phase 3) asks Jev for typed judgements.
**It never trades.** It logs what it *would* have picked so the picks can be scored.

## Setup (once)

```bash
cd ~/repositories/jev-desk
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # then put your real key in .env
chmod 600 .env
```

## Run a scan (Phase 2: data only, no AI)

```bash
source .venv/bin/activate
python run_scan.py            # funnel summary + finalists
python run_scan.py --verbose  # every token's numbers and why it died
```

The first run has an empty watchlist, so most tokens will be `too_young`.
Run it again every 15 minutes or so and the watchlist fills up.

## Files

| file | job |
|---|---|
| `thresholds.py` | every tunable number; the only file you edit to retune |
| `sources.py` | GeckoTerminal and Solana RPC clients, rate-limited |
| `collect.py` | turns API responses into the desk's field names |
| `filter.py` | the plain-fact checks, in the order they fire |
| `db.py` | watchlist and bench, in `desk.db` |
| `solana_util.py` | tells real wallets from pools (on-curve check) |
| `run_scan.py` | one full scan |

## Fixes vs. the original guide

- Authorities: GeckoTerminal reports renounced as the string `"no"`, not null.
  The guide's check would have rejected every Solana token.
- Top wallet: pools, bonding curves and lockers are excluded (off-curve owners),
  and token accounts are summed by owner. The guide counted the pool as a whale.
- Bonding-curve tokens (not yet graduated) are skipped until they have a real pool.
- Market data comes from GeckoTerminal (30 tokens per call) instead of FOMO's private API.
