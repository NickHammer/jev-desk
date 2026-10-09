# jev-desk architecture

How the project works, top to bottom. GitHub renders the diagrams below automatically.
This file is updated with every phase; see `CHANGELOG.md` for the history.

**Current state:** Phases 1–4 built. Shadow mode only: the desk never holds keys or money.

## 1. The big picture

```mermaid
flowchart TD
    you(["You, by hand for now<br/>(Phase 5 adds a timer)"])
    you --> scan["run_scan.py<br/>find and fact-check launches"]
    scan --> latest[("runs/latest.json<br/>finalists")]
    latest --> judgeRun["run_judge.py<br/>Jev judges the finalists"]
    judgeRun --> judged[("runs/judged-*.json<br/>answers + shadow pick")]
    judgeRun --> tracked[("tracked table in desk.db<br/>every judged token + its price")]
    you --> scoreRun["score.py<br/>re-prices at 1h / 6h / 24h"]
    tracked --> scoreRun
    scoreRun --> card["scorecard<br/>picks vs passes vs rejects"]

    subgraph ext["Outside services (read-only)"]
        gt["GeckoTerminal<br/>free, 10 calls/min"]
        rpc["Solana RPC via Helius<br/>free tier"]
        jev["TypeSafe Jev<br/>~$0.042 per million tokens"]
    end

    scan <--> gt
    scan <--> rpc
    judgeRun <--> jev
    scoreRun <--> gt
```

## 2. The scan: from ~140 launches to a handful of finalists

Each stage costs more than the one before it, so each one has to reject harder.
Numbers on the arrows are from the 2026-10-08 evening run.

```mermaid
flowchart TD
    A["Universe<br/>GeckoTerminal new_pools x2 pages + trending_pools x1"] --> B[("watchlist in desk.db<br/>remembered between runs")]
    B --> C{"Benched?"}
    C -- yes --> skip["skip this run"]
    C -- no --> D["Market pass<br/>GeckoTerminal tokens/multi, 30 tokens per call<br/>138 checked"]

    D --> MK{"market_kill"}
    MK -- "bonding_curve 88<br/>too_old 21, too_young 11<br/>liquidity 8, volume 2<br/>turnover 1" --> bench1["bench by reason,<br/>or drop if stale"]
    MK -- "7 pass" --> E["Rank by liquidity<br/>top 6 get a dossier"]

    E --> F["Dossier<br/>GeckoTerminal token info<br/>+ mint/freeze authority from chain<br/>+ largest holders from chain, pools excluded"]
    F --> CK{"chain_kill"}
    CK -- "top_wallet 1" --> bench2["bench"]
    CK -- "5 pass" --> G[("runs/latest.json")]
```

### The checks, in the order they fire

| Stage | Check | Rejects when | Source |
|---|---|---|---|
| market | `bonding_curve` | still on a launchpad curve (pump-fun, meteora-dbc, ...) | GeckoTerminal dex id |
| market | `too_young` / `too_old` | under 15 minutes or over 72 hours | first pool time |
| market | `liquidity`, `volume`, `mcap`, `trades` | below the floors in `thresholds.py` | GeckoTerminal pool |
| market | `turnover` | 24h volume more than 20x market cap | computed |
| market | `no_sells` | buys going through but no sells | GeckoTerminal pool |
| chain | `authority_open` / `authority_unknown` | mint or freeze still set, or unreadable | Solana chain |
| chain | `holders_unknown` | holder lookup failed | Solana RPC |
| chain | `top_wallet` / `top_10` | one wallet over 5%, top ten over 60% | Solana RPC, pools excluded |
| chain | `holders` | fewer than 80 holders | GeckoTerminal |

## 3. The judge: Jev's typed answers

```mermaid
flowchart TD
    L[("runs/latest.json")] --> T["for each finalist"]
    T --> M["Call 1: market set<br/>numbers only<br/>shape, liquidity fits, momentum spent,<br/>concentration, dev loaded, wash trading"]
    T --> P["Call 2: project set<br/>text only<br/>effort score, copycat"]
    M --> K{"judge_fails<br/>vs SOFT in thresholds.py"}
    P --> K
    K -- "any fail" --> X["rejected<br/>every failed check logged"]
    K -- passes --> S["survivors"]
    S --> N{"how many?"}
    N -- 0 --> NT["NO TRADE"]
    N -- 1 --> ONE["single survivor<br/>no pick call needed"]
    N -- "2+" --> PK["Call 3: pick set<br/>best + worth trading at all"]
    PK --> G{"worth >= 0.60<br/>and confidence >= 0.55?"}
    G -- no --> NT
    G -- yes --> WB["WOULD BUY (shadow)<br/>size factor 0.6, no X read"]
    ONE --> WB
    WB --> OUT[("runs/judged-*.json")]
    NT --> OUT
    OUT --> TR["track every judged token<br/>verdict pick / pass / reject + price"]
    X --> TR
```

**Code fetches, Jev judges, code decides.** Jev only returns probabilities. Every
yes/no line lives in `thresholds.py`, and every piece of arithmetic (average trade
size, trades per holder, ticket share of liquidity) is computed in `judge.py` before
the call.

### What a Jev call looks like

```mermaid
sequenceDiagram
    participant R as run_judge.py
    participant J as judge.py
    participant Q as questions.py
    participant API as Jev API
    R->>J: market_state(finalist)
    J->>J: compute avg_trade_usd, trades_per_holder,<br/>ticket % of liquidity, percents
    R->>J: ask("market", state)
    J->>Q: SETS["market"]
    J->>API: system_one(state, questions)
    API-->>J: model "jev-1.13.0", answers, usage
    J-->>R: raw answers, model id, token usage
    R->>R: judge_kill(answers) against thresholds
```

## 4. The scorekeeper: did the desk's calls hold up?

```mermaid
flowchart TD
    T[("tracked table<br/>price at judgement, verdict, failed checks")] --> D{"a checkpoint is due?<br/>1h, 6h or 24h after judgement"}
    D -- "not yet" --> W["wait for a later run"]
    D -- "overdue by 3x" --> GU["give up on that checkpoint<br/>never filled late"]
    D -- due --> PR["GeckoTerminal tokens/multi<br/>current price, 30 per call"]
    PR -- "no price" --> RT["retry on a later run"]
    PR -- price --> F["store price + minutes elapsed"]
    F --> R["scorecard"]
    R --> R1["by verdict<br/>pick, pass, reject, all"]
    R --> R2["rejects by check<br/>did this check throw away winners?"]
```

Returns are measured from the price at judgement and shown after an assumed 3%
round-trip cost (`ROUND_TRIP_COST_PCT`). "Win" is the share of tokens that would have
made money after that cost. A token judged again within 24 hours is not tracked again,
so busy tokens don't count many times; a pick is always recorded.

The scorecard warns until each group has 30+ results at 24h. Before that, differences
are noise.

## 5. A token's life

```mermaid
stateDiagram-v2
    [*] --> Watching: found in new or trending pools
    Watching --> Benched: failed a check
    Benched --> Watching: bench time is up
    Watching --> Dropped: still failing after 6h, or older than 72h
    Benched --> Dropped: permanent fact, such as open authority or a whale
    Watching --> Finalist: passed market and chain checks
    Finalist --> Rejected: failed a Jev check
    Finalist --> Picked: chosen as the shadow buy
    Picked --> Tracked: price recorded
    Rejected --> Tracked: price recorded
    Tracked --> Scored: priced at 1h, 6h, 24h
    Scored --> [*]
    Dropped --> [*]
```

Bench lengths depend on why a token failed, so facts that will never change (an open
mint, a 7% whale) sit out for good, while "too young" or "no pool yet" come back within
minutes.

## 6. Files and who calls whom

```mermaid
flowchart LR
    subgraph entry["Run these"]
        rs["run_scan.py"]
        rj["run_judge.py"]
        sc["score.py"]
    end
    subgraph core["Pipeline"]
        src["sources.py<br/>API clients, rate limits"]
        col["collect.py<br/>API data to desk fields"]
        fil["filter.py<br/>market, chain, judge checks"]
        jd["judge.py<br/>states + Jev calls"]
        qs["questions.py<br/>every Jev question"]
    end
    subgraph support["Support"]
        th["thresholds.py<br/>every tunable number"]
        db["db.py<br/>watchlist + bench"]
        su["solana_util.py<br/>wallet vs pool test"]
    end
    rs --> src & col & fil & db
    rj --> jd & fil & db
    sc --> src & db
    jd --> qs
    src --> su
    src & fil & db & jd --> th
```

## 7. Where data lives

| Place | What | Kept in git? |
|---|---|---|
| `.env` | Jev key, Helius RPC URL, `RPC_PER_MINUTE` | **never** |
| `desk.db` | watchlist, bench and tracked outcomes (SQLite) | no |
| `runs/latest.json` | finalists from the last scan | no |
| `runs/judged-*.json` | every Jev answer, model id, and shadow pick | no |
| everything else | code and docs | yes |

## 8. Roadmap

| Phase | What | Status |
|---|---|---|
| 1 | Pi setup, keys, API tests | done |
| 2 | Scanner with market and chain checks | done |
| 3 | Jev judges the finalists | done |
| 4 | Shadow scorekeeper: every judged token re-priced at 1h / 6h / 24h | **built, testing on the Pi** |
| 5 | Run unattended every 15 minutes (systemd timer) | next |
| 6 | Review the scorecard; decide whether execution is worth building | planned |
| later | Dashboard served from the Pi; optional X reading via xAI | ideas |
