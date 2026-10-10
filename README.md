# jev-desk

A shadow-mode memecoin scanner for a Raspberry Pi. It watches new Solana launches,
filters them with plain-fact checks, then asks Jev for typed judgements.
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

## Ask Jev about the finalists (Phase 3)

```bash
python run_scan.py && python run_judge.py
```

`run_judge.py` prints Jev's numbers for each finalist, which check (if any) rejected it,
and a shadow `WOULD BUY` or `NO TRADE`. Results are saved under `runs/`.
Each run costs a fraction of a cent.

## Score the shadow picks (Phase 4)

```bash
python run_scan.py && python run_judge.py && python score.py
```

Every judged token's price is saved, and each scan also tracks 3 random market
survivors as a **control group**, never judged: the baseline Jev has to beat. `score.py`
re-prices them all 1h, 6h and 24h later and prints a scorecard. It shows how picks,
passes, rejects and the control group did after a 3% trading cost, and how tokens
rejected by each check did. Each checkpoint is only priced in a short window after it
falls due (30 min / 2 h / 6 h). A token that never gets a price is counted as "gone"
(likely rugged), and a worst-case table counts those as −100%.

Every tracked token carries a **settings stamp**, a short code for the settings that
decided it. After you change `thresholds.py`, `questions.py`, `judge.py` or `filter.py`,
`python score.py --settings current` shows only results under the new settings.

## Run it unattended (Phase 5)

```bash
bash deploy/install.sh        # as your normal user; it asks for sudo
```

That installs a systemd timer that runs `run_all.sh` (scan, judge, score) every 15
minutes, including after reboots. Useful commands:

```bash
journalctl -u jev-desk -f                       # watch cycles live
journalctl -u jev-desk --since today            # today's cycles
systemctl list-timers jev-desk.timer            # when the next cycle runs
sudo systemctl start jev-desk.service           # run one cycle now
.venv/bin/python score.py --no-update           # print the scorecard any time
.venv/bin/python score.py --no-update --settings current   # only today's settings
.venv/bin/python whatif.py wash_trading=0.8 effort=0.5      # replay Jev's answers under other limits
.venv/bin/python whatif.py --sweep wash_trading             # try a range for one check
.venv/bin/python signals.py                                 # do the attention signals predict anything?
sudo systemctl disable --now jev-desk.timer     # stop it
```

After pulling new code, nothing needs reinstalling: the next cycle uses it. Re-run
`deploy/install.sh` only if the files in `deploy/` change.

## The dashboard

`deploy/install.sh` also installs the dashboard as a service. It starts on boot,
restarts itself if it crashes, and replaces one you started by hand. Open
**http://raspberry-3-14-15.local:8080** on any computer on your home network (or
`http://<pi ip>:8080`; `hostname -I` on the Pi shows its IP). It is read-only: it shows
the desk, and it can't change or trade anything.

```bash
systemctl status jev-dashboard                  # is it running?
journalctl -u jev-dashboard -f                  # its log
sudo systemctl restart jev-dashboard            # after pulling changes to dashboard/server.py
sudo systemctl disable --now jev-dashboard      # stop it for good
```

Changes to the page itself (`dashboard/static/`) only need a browser refresh
(Ctrl+Shift+R). To run it by hand instead: `.venv/bin/python dashboard/server.py`.

**📺 Pacers TV:** the button in the top bar, or the remote on the floor's couch, turns
on the TV in the break corner. It plays the latest Pacers highlights from YouTube in a
loop with YouTube's own player. ⏮ ⏭ on the TV cabinet skip through the list (it wraps
around), and the caption shows where you are, e.g. "3 / 24". Press Esc or click again
to turn it off.

It plays a playlist you choose, set as one line in `.env` (the playlist's link or just
its `PL...` id). Without one, it falls back to the Pacers and NBA channel feeds
(`HIGHLIGHT_SOURCES` in `dashboard/server.py`). After changing it, restart the
dashboard:

```bash
printf '\nTV_PLAYLIST=https://www.youtube.com/playlist?list=PL...\n' >> .env
sudo systemctl restart jev-dashboard
```

See `ARCHITECTURE.md` for diagrams of how it all fits together, and `GLOSSARY.md` for
plain-English definitions of the terms used.

## Files

| file | job |
|---|---|
| `thresholds.py` | every tunable number; the only file you edit to retune |
| `sources.py` | GeckoTerminal and Solana RPC clients, rate-limited |
| `collect.py` | turns API responses into the desk's field names |
| `filter.py` | the plain-fact checks, then the checks on Jev's answers |
| `db.py` | watchlist, bench and tracked outcomes, in `desk.db` |
| `solana_util.py` | tells real wallets from pools (on-curve check) |
| `run_scan.py` | one full scan |
| `questions.py` | every question Jev is asked |
| `judge.py` | the only code that calls Jev; builds the state it sees |
| `run_judge.py` | asks Jev about the last scan's finalists, tracks them for scoring |
| `score.py` | prices tracked tokens at 1h / 6h / 24h and prints the scorecard |
| `run_all.sh` | one full cycle: scan, judge, score |
| `events.py` | the event log the dashboard animates from (`runs/events.jsonl`) |
| `dashboard/` | the dashboard server and page |
| `deploy/` | systemd timer, service, and `install.sh` |
| `ARCHITECTURE.md` | diagrams of the whole pipeline |
| `GLOSSARY.md` | plain-English definitions of the terms used |
| `settings_stamp.py` | the short code for the settings that decided each tracked token |
| `whatif.py` | replays Jev's saved answers under other limits, read-only |
| `signals.py` | attention signals recorded with every tracked token, and their report |
| `CHANGELOG.md` | what changed and when |

## Fixes vs. the original guide

- Authorities: GeckoTerminal reports renounced as the string `"no"`, not null.
  The guide's check would have rejected every Solana token.
- Top wallet: pools, bonding curves and lockers are excluded (off-curve owners),
  and token accounts are summed by owner. The guide counted the pool as a whale.
- Bonding-curve tokens (not yet graduated) are skipped until they have a real pool.
- Market data comes from GeckoTerminal (30 tokens per call) instead of FOMO's private API.
