# Glossary

Plain-English definitions for the words used in this project, its output and the
dashboard. Grouped by topic; alphabetical within each group.

## Testing whether Jev has an edge

- **After cost**: a return with the assumed 3% trading cost already taken off. A token that rose 2% shows as −1%.
- **Baseline (comparison group)**: what you'd get with no judgement at all, e.g. buying every token that passed the free code checks. Jev only adds value if its passes beat the baseline.
- **Checkpoint**: a moment we look up a judged token's price again: 1 hour, 6 hours and 24 hours after it was judged.
- **Control group**: 3 random tokens per cycle that passed the free market check and were never judged. They're priced like the rest; this is the baseline.
- **Edge**: a real, repeatable advantage. Here, Jev's passes doing clearly better than the baseline over many tokens.
- **Gone checkpoint**: we tried at least twice and there was no price at all. The token most likely rugged or was delisted.
- **Missed checkpoint**: the window closed with too few tries, for example because the Pi was off.
- **Pending checkpoint**: not due yet.
- **Priced checkpoint**: the price was taken on time.
- **Round-trip cost**: what buying and then selling would cost in fees and slippage. We assume 3%.
- **Sample size (n)**: how many results a number is based on. Under ~30, a difference is likely luck.
- **Scorecard**: the table `score.py` prints: average return and win rate per group at each checkpoint.
- **Settings stamp**: an 8-character code for the settings that decided a token. When the settings change, so does the stamp, so before and after results are never mixed.
- **Shadow mode**: the desk decides and records what it *would* do, but never trades or holds money.
- **Survivorship bias**: averages look better than reality when the worst outcomes (rugs that disappear) drop out of the data.
- **Win rate**: the share of tokens that would have made money after cost.
- **Worst case**: the scorecard again with every gone checkpoint counted as −100%, so rugs that vanished still count.

## Memecoins and Solana

- **Bonding curve**: the starter phase of a pump.fun launch, where the price is set by a formula before real trading starts. We skip these tokens.
- **Copycat**: a token riding someone else's name or a trending topic instead of being its own thing.
- **Dev wallet**: the wallet of whoever launched the token. If it still holds a lot, the dev can dump on buyers.
- **DEX (decentralized exchange)**: an exchange run by code on the blockchain. Raydium, Orca, PumpSwap and Meteora are DEXes.
- **Freeze authority**: a permission that lets the token creator freeze anyone's tokens. Should be renounced ("no").
- **Graduated**: a token that left its bonding curve and now trades in a normal pool.
- **Holders**: how many wallets own the token.
- **Jupiter**: the Solana service that finds the best price across DEXes. Would be how trades are made, if this ever went live.
- **Liquidity**: the money sitting in a token's trading pool. More liquidity means you can buy and sell without moving the price much.
- **Market cap (mcap)**: price × number of tokens. What the whole token is "worth" on paper.
- **Memecoin**: a token with no business behind it, driven by attention and hype. Most go to zero.
- **Mint (token address)**: a token's unique ID on Solana. Tickers repeat; mints don't.
- **Mint authority**: a permission that lets the creator print more tokens. Should be renounced ("no").
- **Pool**: the pot of a token and SOL (or USDC) that trades happen against.
- **pump.fun**: the most popular Solana memecoin launchpad.
- **Renounced**: a permission permanently given up, so nobody can use it again.
- **Rug pull (rug)**: the creator or insiders take the money and leave; the price collapses, often to nearly zero.
- **Solana (SOL)**: the blockchain these tokens live on.
- **Ticker**: a token's short name, like SENTS. Not unique.
- **Top wallet / whale**: the single biggest holder. Over 5% of supply and they can crash the price alone.
- **Top 10**: the share of supply held by the ten biggest wallets, not counting pools.
- **Turnover**: 24h trading volume divided by market cap. Very high turnover can mean fake trading.
- **Volume**: how much money traded hands, usually over 24 hours.
- **Wash trading**: wallets trading with each other to make a token look busy and popular.

## How the desk works

- **Bench**: a timeout. A rejected token sits out for a while (minutes to days, depending on why) before it can be checked again.
- **Chain check (Dossier)**: free facts read straight from Solana: authorities, top wallets, holder count.
- **Cycle**: one full run of scan → judge → score. Runs every 15 minutes.
- **Effort score**: Jev's 0–3 rating of how much real work went into a token's name, description, website and socials.
- **Finalist**: a token that survived every free code check and goes to Jev.
- **Funnel**: the order of checks, cheapest first, so each stage only sees what the last one let through.
- **Hard thresholds**: fixed limits in `thresholds.py` that code applies to numbers (age, liquidity, volume…).
- **Jev**: TypeSafe's AI model. It only answers questions; code decides what to do with the answers.
- **Market check**: the free first filter on price data: age, liquidity, volume, market cap, trades, turnover.
- **Momentum already spent**: Jev's guess that most of the move already happened, so you'd be buying late.
- **Pass**: survived Jev's checks but wasn't the one picked.
- **Pick**: the one token the desk would have bought in that cycle (at most one).
- **Reject**: failed at least one of Jev's checks.
- **Rejects by check**: the scorecard table showing how rejected tokens did, grouped by the check that rejected them. A check whose rejects did well may be throwing away winners.
- **Shape**: Jev's read of how a launch is trading: a real crowd, one big buyer, fading, or too early to tell.
- **Soft thresholds**: limits applied to Jev's answers (e.g. "wash trading likelihood must be under 0.60").
- **Verdict**: pick, pass or reject.
- **Watchlist**: new launches the scanner keeps re-checking until they pass, fail for good, or age out.

## Services and tools

- **GeckoTerminal**: free website/API with prices, pools and candles for DEX tokens. Our market data.
- **Helius**: a company that runs Solana servers we query (RPC). Free tier, much faster than the public one.
- **RPC**: the way a program asks a blockchain server a question ("who holds this token?").
- **systemd timer**: the Pi's built-in scheduler; it starts a cycle every 15 minutes and on boot.
- **TypeSafe**: the company behind Jev; billed per token of text sent (about $0.04 per million).
