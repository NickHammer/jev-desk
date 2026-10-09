# Changelog

All notable changes to jev-desk. Newest first.

## 2026-10-08: Phase 4, the shadow scorekeeper

### Added
- **`score.py`**: prices every judged token 1h, 6h and 24h after its judgement and
  prints a scorecard. Returns are shown after an assumed 3% round-trip cost, split by
  verdict (`pick`, `pass`, `reject`), plus a table of how rejected tokens did under each
  check that fired. That answers whether the rejected tokens really do worse and
  whether any single check throws away winners. `--no-update` prints without pricing.
- **Every judged token is tracked**, not only picks, so a run with no trade still
  produces evidence. A token judged again within 24 hours isn't tracked twice; a pick
  is always recorded.
- **`tracked` table in `desk.db`**, created automatically on the next run. It stores
  the judged price, the verdict, every failed check, and each checkpoint's price with
  the minutes that had actually passed.
- **`sources.token_prices()`**: current prices for 30 tokens per GeckoTerminal call.
- **Phase 4 settings in `thresholds.py`**: `CHECKPOINTS`, `ROUND_TRIP_COST_PCT`,
  `TRACK_DEDUP_HOURS`, and `GIVE_UP_FACTOR` (a checkpoint not priced within 3x its delay
  is abandoned rather than filled late with a misleading price).

### Changed
- **`run_judge.py` shows every failed check** for each token, not just the first, and
  saves the full list (`fails`) in `runs/judged-*.json`.
- `filter.judge_fails()` returns all failures; `judge_kill()` now wraps it.

## 2026-10-08: Phase 3, Jev judges the finalists

### Added
- **`run_judge.py`**: reads the finalists from the last scan, asks Jev about each one,
  applies the thresholds, picks at most one token, and prints a shadow "WOULD BUY" or
  "NO TRADE". Saves everything to `runs/judged-<UTC time>.json` and `judged-latest.json`.
  Nothing is traded.
- **`questions.py`**: every question Jev is asked, in two sets per token plus a pick:
  - `market` (numbers only): launch shape, liquidity fits the ticket, momentum already
    spent, holder concentration, dev still loaded, and a new **wash trading** question.
  - `project` (text only, the free substitute for reading X): an **effort** score from
    the listing's name, description, website and handle, and a **copycat** check for
    trend-riding or borrowed names.
  - `pick`: the best survivor, plus "is any of them worth trading at all?"
- **`judge.py`**: calls Jev directly through the SDK's synchronous client (no server,
  desk secret or tunnel). Arithmetic such as average trade size, trades per holder and
  ticket share of liquidity is computed here and passed in as fields. Malformed-question
  errors (400/422) stop the run instead of retrying.
- **`filter.judge_kill()`**: applies Jev's answers to the limits in `thresholds.py`.
  An unanswered question fails, it never passes by default.
- **Jev settings in `thresholds.py`**: `SOFT` limits, `SHAPE_MIN_CROWD`, pick
  thresholds, a $1,000 shadow bank with a 6% maximum ticket, and `NO_SOCIAL_CUT`.
- **`ARCHITECTURE.md`**: Mermaid diagrams of how the whole project works.

### Changed vs. the original guide
- Two calls per token (numbers, then text) instead of three; there is no X-reading call.
- The authority question was dropped: the chain check already settles it as a fact.
- Holder-growth wording was replaced, since we only have a holder count snapshot.
- Pick options are keyed by ticker plus address, because tickers repeat.
- `too_early` is rejected outright, like `fading` and `one_buyer`.

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
