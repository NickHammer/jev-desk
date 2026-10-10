# Changelog

All notable changes to jev-desk. Newest first.

## 2026-10-10: Attention signals, and 30 days of Jev's answers

### Added
- **Attention signals** (`signals.py`), recorded as a JSON column with every tracked
  token, judged and control alike. They never decide a verdict, so the settings stamp is
  unchanged.
  - **Buying momentum:** the last hour's volume, buys and distinct buyers against their
    6-hour hourly pace, and the share of the last hour's trades and wallets that were
    buying. It comes from pool data the scan already fetches; distinct buyers and
    sellers are newly kept from GeckoTerminal.
  - **Holders:** the holder count, holders per hour since launch, and holder growth across
    cycles. A new `holder_snaps` table keeps 3 days of holder counts, one per dossier.
    Each control token gets one GeckoTerminal info call (3 per scan, about 18 s of
    pacing), so control carries the same numbers.
  - **Paid promotion:** DexScreener's active boosts and paid orders (profile, ads,
    community takeover). It is free and needs no key, at about 10 calls a cycle. If
    DexScreener can't be reached, the values are stored as unknown, never as "not
    promoted".
- **`python signals.py`** splits tracked tokens at each signal's median and shows how
  the high and low halves did at 1h, 6h and 24h.

### Changed
- **Jev's saved answers are kept 30 days instead of 7** (`RUN_KEEP_DAYS`), so
  `whatif.py` can replay the whole experiment.

## 2026-10-10: What-if replays and medians

### Added
- **`whatif.py`** replays Jev's saved answers for every judged token in the last 7 days
  (from `runs/judged-*.json`) through the real `judge_fails()` under other limits. It
  shows which tokens would have passed and how they actually did, next to "still
  rejected" and the control group from the same days. Examples:
  `python whatif.py wash_trading=0.8 effort=0.5`, `python whatif.py --drop wash_trading`
  and `python whatif.py --sweep effort`.
  - It never calls Jev, so it costs nothing, and it changes nothing.
  - With no arguments it checks that today's limits reproduce every recorded verdict.

### Changed
- **The scorecard shows the median** next to the average for every group and check.
  Memecoin returns are lopsided: the control group averaged +12% at 1h while only 35%
  of its tokens made money, so the median shows what a typical token did.

No verdict changes: thresholds and questions are untouched, so the settings stamp stays
the same.

## 2026-10-10: Pacers TV plays your playlist first

### Fixed
- **The TV showed "1 / 1" and one 2-minute video.** When a YouTube feed briefly worked
  and found a single highlight, that one-video list took priority over the playlist set
  in `.env`. The playlist you chose (`TV_PLAYLIST`) now always comes first, and the
  feeds are only used without one.

## 2026-10-10: Pacers TV, skip buttons and real looping

### Fixed
- **The TV kept replaying one video and couldn't move through the playlist.** It used a
  plain embed link with YouTube's `loop` option, which loops a single video when given
  a playlist. The TV-sized player was also too small for YouTube to show its own
  playlist controls.

### Changed
- The TV now uses YouTube's IFrame Player API, loaded from youtube.com only the first
  time the TV is turned on:
  - It starts at the first video of the list or playlist.
  - After the last video it goes back to the first.
- **⏮ ⏭ buttons on the TV cabinet** move to the previous or next video and wrap around
  at the ends.
- The cabinet caption shows the position, e.g. "PACERS HIGHLIGHTS · 3 / 24".
- Turning the TV off now removes the player completely, and turning it on again
  starts fresh.

## 2026-10-10: Pacers TV, playlist backup

### Added
- **`TV_PLAYLIST` in `.env`**: a YouTube playlist link, or its `PL...` id, for the TV
  to play when the channel feeds give no videos. On the Pi, YouTube's feeds returned
  404 for every request, so this is now the dependable source. Only this one value is
  read from `.env`, it is checked to be a valid playlist id, and nothing else from
  `.env` reaches the page.
- With neither feeds nor a playlist, the TV shows static and its caption reads
  "NO SIGNAL · SEE README".

## 2026-10-10: Pacers TV on the floor

### Added
- **A TV in the floor's break corner**, on a low cabinet in front of the couch, with a
  remote on the couch seat.
  - **Turning it on:** the 📺 PACERS TV button in the top bar, or a click on the TV or
    the remote. The screen warms up like an old CRT, then plays the latest Pacers
    highlights in a loop with YouTube's own embedded player, laid over the TV's screen.
  - **Turning it off:** Esc, the button or the remote. It shrinks to a dot and goes dark.
  - **While it's on:** it lights up the corner and the couch, and its caption shows how
    many videos are in the rotation. With nothing to play it shows static.
  - **Small screens:** where the TV would be under YouTube's 200 px minimum, the player
    pops out slightly larger, with a pink border.
- **`/api/highlights`**: the server reads the public YouTube upload feeds of the Pacers
  and NBA channels. It keeps titles containing "highlight" (plus "Pacers" for the NBA
  channel), drops anything that isn't a valid video id, removes duplicates and keeps
  the newest 20. Results are cached for 30 minutes, and nothing is fetched unless the TV
  is turned on. Videos are only embedded (youtube-nocookie.com), never downloaded.

### Changed
- The reject bin moved next to the TV, and the water cooler is only drawn when there is
  no room for a TV.

## 2026-10-10: Better data, and the dashboard as a service

### Added
- **Control group (the baseline).** Each scan also tracks 3 random tokens that passed
  the free market check (`CONTROL_PER_CYCLE`), with no chain check and no Jev. They are
  priced at 1h, 6h and 24h like everything else. Jev's passes have to beat them to be
  worth paying for. The scorecard and the dashboard's P&L chart show them as their own
  group, "control".
- **Gone checkpoints.** A checkpoint that still has no price after 2+ tries when its
  window closes (`GONE_AFTER_TRIES`) is counted as "gone", meaning likely rugged or
  delisted, instead of quietly missed. The scorecard adds a worst-case table that counts
  gone checkpoints as −100%, so vanished rugs no longer make the averages look better.
- **Settings stamp** (`settings_stamp.py`). Every tracked token carries an 8-character
  code for the settings that decided it: the decision settings in `thresholds.py` plus
  `questions.py`, `judge.py` and `filter.py`. `python score.py --settings current`
  shows only tokens tracked under today's settings, so a tuning change never mixes
  before-and-after results. The new `settings` table remembers what each stamp meant.
- **The dashboard runs as a service** (`deploy/jev-dashboard.service`). It starts on
  boot and restarts itself if it crashes. `deploy/install.sh` installs it and stops a
  dashboard you started by hand.

### Changed
- The scorecard's "all" row is now "judged" (pick + pass + reject). The control group
  is kept apart from it.
- The scorecard footer counts checkpoints as priced, pending, gone or missed, and lists
  the settings stamps it includes.
- The dashboard's Scorekeeper card shows "N judged · N control". The floor's "judged
  today" strip and scoreboard leave the control group out.
- `desk.db` gets its new columns and table automatically on the next run. Nothing
  already tracked is lost; those tokens show as "unstamped".

No verdict changes: every threshold and Jev question is exactly as before.

## 2026-10-10: Glossary

### Added
- **`GLOSSARY.md`**: short, plain-English definitions of the terms used across the
  project, its output and the dashboard, in four groups: testing for an edge,
  memecoins and Solana, how the desk works, and the services it uses. It is linked
  from the README.

## 2026-10-09: Dashboard, step 3 (the courier cat and the show)

### Added
- **The floor now acts out each cycle as it happens.** Every event becomes one step:
  - **Speech bubbles** with what each stage just did, for example "+31 new · 214
    watched", "PQC ✗ authority_open", "would buy SENTS".
  - **The courier cat**, an orange cosmic kitten with glowing eyes, a star on its
    forehead, a glowing tail tip and orbiting stars. It flies each stage's batch to
    the next desk, and each token that passes Jev to Pick, holding them in its front
    paws and leaving a trail of stardust. It floats beside each desk's monitor and
    waits by the right-hand banner between trips. (This replaces the spider from the
    original plan.)
  - **Rejected tokens** are balled up and thrown into the bin.
  - **Walks:** Pick walks to the head desk to report its decision and the Desk
    answers. The Scorekeeper walks to the scoreboard when a checkpoint is priced.
  - The character on the current step glows, so Jev·Market and Jev·Text take turns
    on each token.
- **Pacing:** steps play one at a time, and speed up when events arrive faster than
  they can be shown. Only events that happen while the page is open are animated.
- **Replay:** between cycles (20 seconds after the page opens, then every 4 minutes)
  the floor replays the last finished cycle in about 40 seconds. A pink "▶ REPLAY ·
  cycle of HH:MM" tag shows under the wall screen. A live event stops the replay at
  once.
- `Office.debug()` in the browser console shows what the show is doing.

## 2026-10-09: Dashboard, step 2.1 (new layout, detailed pixel art)

### Changed
- **Layout:** the 8 stage cards are one column on the left. The floor sits directly
  under the title and stretches to the cards' height. Shadow P&L, Jev analysis and
  `thresholds.py` share one row below, with thresholds in two columns. At 1920×1080
  almost the whole page fits without scrolling. Smaller screens fall back to two
  rows below the floor, and phones to one column.
- **The floor is redrawn in a detailed pixel-art style:**
  - Outlines, three-tone shading with a rim light, and monitor light spilling onto
    desks and faces.
  - A perspective floor with a rug, ceiling lamps, scanlines and a vignette.
  - The room fills the panel's full width: the desks stay centred and the sides
    stretch, so there are no empty bars. On narrow screens the ceiling gets higher
    instead.
- **Characters keep their shapes and colors**, now shaded and each with an accessory:
  - Scout has an antenna, Market a tie and Dossier glasses.
  - Jev·Market and Jev·Text have halos, Pick a star, the Scorekeeper a clipboard and
    the Desk a headset.
  - They blink, glance around and type now and then.
  - The working character glows, types fast and watches its screen.
- **Each desk's monitor shows its job:** radar (Scout), volume bars (Market), rows
  being checked (Dossier), a price line (Jev·Market), text being read (Jev·Text) and
  three candidates with one chosen (Pick).
- **More real data on the floor:**
  - Finalist chips sit on a wall board, scaled to the room.
  - A "judged today" strip has one colored square per verdict.
  - The scoreboard charts the last 14 tokens' 1h results after cost.
  - The wall screen says how long until the next cycle.
- The per-finalist list under the analysis chart is hidden to save height. The chips
  on the floor show the same verdicts.

## 2026-10-09: Dashboard, step 2 (the look, the office, the characters)

### Added
- **`dashboard/static/office.js`**: "the floor", a pixel-art office drawn entirely in
  code (no image files): a wall screen showing the selected finalist's real 5-minute
  candles, banners with the desk's diamond mark, a clock, a "today" board (cycles,
  tokens judged, picks, Jev spend), six desks with live monitors, a head desk, a
  scoreboard with a rocket trophy and the 1h average, a blinking server rack (busier
  while a cycle runs), a "rejected" bin that fills as tokens are rejected, plants and a
  break-corner couch.
- **One original character per stage**, each with its own shape and color, matching
  its card's icon: Desk (ghost with a headset, head of the floor), Scout (circle),
  Market (blob), Dossier (square), Jev·Market (triangle), Jev·Text (diamond), Pick
  (spiky) and Scorekeeper (bean). They idle, blink and bob; while a cycle runs, the
  character for the stage that is working glows, bounces and lights up its monitor and
  card.
- Finalist chips sit on the office wall; hover for the verdict, click to show that
  token in the analysis and thresholds panels and on the wall screen.
- The pink frame has a subtle grid, as in the reference design.

### Changed
- While a cycle is running, stage cards keep the last finished cycle's results for
  anything the new cycle hasn't reported yet, instead of going blank.
- `/api/state` also returns `live_stages`, the stages the running cycle has reached.
- Chart axis labels no longer overlap the $0 line.

## 2026-10-09: Dashboard, step 1 (real data, no animation yet)

### Added
- **`events.py`**: an event log. Each step of a cycle appends one JSON line per thing
  that happens to `runs/events.jsonl` (cycle start, tokens found, each market and
  dossier result, every Jev verdict, the pick, benches, each checkpoint priced, cycle
  end). Events older than 48 hours are pruned at the start of each scan. Writing an
  event can never fail a cycle. `run_all.sh` gives every cycle a shared id (`JEV_CYCLE`).
- **`dashboard/server.py`**: "Nick's Jev Trading Desk", a read-only web server using
  only Python's standard library plus `requests`. It serves the page and a JSON API
  (`/api/state`, `/api/events`, `/api/cycle`, `/api/ohlcv`). It opens `desk.db`
  read-only, serves files only from `dashboard/static/`, and never exposes `.env`.
  Price candles come from GeckoTerminal, cached 5 minutes and at most one call every
  30 seconds, so the pipeline keeps its rate budget.
- **`dashboard/static/`**: the page, laid out like the final design: 8 stage cards
  (Desk, Scout, Market, Dossier, Jev·Market, Jev·Text, Pick, Scorekeeper), a live
  event ticker, finalist chips, a shadow P&L chart ($100 per token after the 3% cost,
  for picks, passes and rejects), a Jev analysis panel with 5-minute candles and each
  check's PASS/DROP, and a live `thresholds.py` panel with the current token's values.
  The pixel office, characters and spider come in steps 2 and 3.
- Every token name and description is escaped before display, since they come from
  the internet; tested with a token named like an HTML injection.

### Changed
- `db.due_checkpoints()` also returns each row's ticker, verdict and start price, so
  priced checkpoints can be logged as events.

## 2026-10-09: Phase 5, running unattended

### Added
- **15-minute timer** (`deploy/jev-desk.service`, `deploy/jev-desk.timer`): systemd runs
  one full cycle every 15 minutes, survives reboots, catches up once after the Pi was
  off, and never lets two cycles overlap. Logs go to `journalctl -u jev-desk`.
- **`deploy/install.sh`**: fills in your username and project folder and installs the
  timer. Run it as your normal user; it asks for sudo itself.
- **`run_all.sh`**: one cycle (scan, judge, score). If the scan fails, the judge is
  skipped so old finalists aren't judged twice; scoring still runs. Exits non-zero if
  any step failed, so `systemctl status jev-desk` shows it.
- **Old runs are cleaned up**: `runs/judged-*.json` older than 7 days (`RUN_KEEP_DAYS`)
  are deleted at the start of each judge run. Scores live in `desk.db` and are kept.
- **Tokens Jev rejects are benched.** A token failing several checks sits out the
  longest of their times: 30 min for momentum, liquidity fit or shape; 60 min for wash
  trading; 90 min for concentration or a loaded dev; 6 hours for effort or copycat; 20
  min if Jev didn't answer. This frees dossier slots for new tokens; before, the same
  six finalists were re-judged every run.

### Fixed
- **Checkpoints are only priced inside a tight window** (`CHECKPOINT_WINDOW`): 30 min
  after the 1h mark, 2h after 6h, 6h after 24h. The old rule allowed up to 3x the delay,
  so a "6h" price could really be 14 hours old. Checkpoints that miss their window are
  reported as `missed`. `GIVE_UP_FACTOR` is gone.
- The scorecard footer now counts checkpoints as priced, pending, or missed.

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
