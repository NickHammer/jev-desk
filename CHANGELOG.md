# Changelog

All notable changes to jev-desk. Newest first.

## 2026-10-08

### Added
- **Turnover check** (`max_turnover`, default 20): rejects tokens whose 24h volume is
  more than 20x their market cap. Volume that far beyond a token's value usually means
  wallets trading with each other to look busy. Turnover is also kept as a field
  (`turnover`) for Jev to judge in Phase 3.
- **Unknown holder data rejects the token** (`holders_unknown`, 20-minute bench). If the
  RPC holder lookup fails, the token no longer passes as if it were safe.
- `CHANGELOG.md`.

### Changed
- **Dossier candidates are ranked by liquidity, not turnover.** Turnover ranking pushed
  wash-traded tokens to the front; liquidity is much harder to fake.
- **Scan output shows the top-10 figure actually used** and where it came from:
  `(rpc)` for our pool-excluded number, `(gt)` for GeckoTerminal's fallback.

## 2026-10-07

### Added
- Mint and freeze authority are read directly from the Solana chain; GeckoTerminal is
  the fallback. Tokens whose authorities can't be read are rejected (`authority_unknown`).
- Solana RPC calls are paced and retried on rate limits. `RPC_PER_MINUTE` can be set in
  `.env` (use ~300 with a private RPC such as Helius).
- Watchlist is checked newest first with a per-run cap; tokens still failing after
  6 hours are dropped instead of rechecked forever.

### Changed
- Market data comes from GeckoTerminal (`tokens/multi`, 30 tokens per call).
  DexScreener returned empty pairs for every token.

### Fixed
- X Community links (`x.com/i/communities/...`) are no longer read as a handle.

## 2026-10-07: Phase 2, first version
- Solana scanner with market and chain checks, no AI and no trading.
- Fixes vs. the original guide: renounced authorities are the string `"no"`, not null;
  pools and lockers are excluded from the top-wallet check; bonding-curve tokens are
  skipped until they graduate.
