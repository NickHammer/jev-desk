"""Every question the desk asks Jev lives here and nowhere else.

Three primitives (from the TypeSafe SDK):
  Noul    "is this true?"            -> one probability, 0 to 1
  Choice  "which one?"               -> the choice, its confidence, all probabilities
  Score   "rate it on my rubric"     -> a score, its confidence, the legend

Two calls per finalist, grouped by what the questions read:
  MARKET   numbers only (price, volume, trades, holders)
  PROJECT  text only (name, description, website, X handle)
plus one PICK call over all survivors. Keeping numbers and text in separate calls keeps
each state small and on-topic, which the guide found matters for accuracy.

Arithmetic is done in code (judge.py) and passed in as fields. Jev only judges.
"""

from typesafe_sdk import Choice, Noul, Score

MARKET = {
    "shape": Choice(
        instructions="Classify the shape of this launch from the fields in `state`. "
                     "Percent fields are percents (12.5 means 12.5%).",
        criteria={
            "crowd": "Many separate buyers. Buys outnumber sells in both the 1h and 6h "
                     "windows, holder_count is large for the token's age, and volume is "
                     "spread across hours rather than one spike.",
            "one_buyer": "Price is rising on few holders or a handful of large trades. "
                         "avg_trade_usd is large relative to liquidity, or holder_count is "
                         "small for the volume traded.",
            "fading": "volume_last_1h is a small fraction of avg_hourly_volume_24h, or sells "
                      "outnumber buys in both the 1h and 6h windows.",
            "too_early": "Too few trades or too little history to tell the others apart.",
        }),
    "liquidity_fits_ticket": Noul(
        instructions="A position of `intended_ticket_usd` could be bought and later sold "
                     "into `liquidity_usd` without moving the price more than a few percent. "
                     "`ticket_percent_of_liquidity` is precomputed."),
    "momentum_already_spent": Noul(
        instructions="The move in `change_percent` has already happened, so buying now "
                     "means buying after the run-up is over.",
        criteria={"true": "The large gains sit in the older windows (6h, 24h) while the "
                          "recent windows (5m, 1h) are flat or falling.",
                  "false": "The recent windows carry the move, or there has been no big "
                           "move yet."}),
    # --- Solana holder structure -------------------------------------------------
    "concentration_is_exit_risk": Noul(
        instructions="Holding this token means being someone's exit liquidity, judged "
                     "from `top_wallet_percent`, `top_10_percent` and `holder_count`. "
                     "Pools and lockers are already excluded from the wallet figures.",
        criteria={"true": "A few wallets could crash the price by selling.",
                  "false": "Supply is spread widely enough to absorb any one large seller."}),
    "dev_still_loaded": Noul(
        instructions="`dev_holding_percent` is large enough that the creator selling would "
                     "meaningfully move the price. If it is null the developer's holdings "
                     "are unknown, which is a risk, not reassurance."),
    # --- Fake volume -----------------------------------------------------------------
    "wash_trading": Noul(
        instructions="The trading volume is mostly wallets trading with each other to look "
                     "busy, rather than real demand. Judge from `turnover` (24h volume "
                     "divided by market cap), `avg_trade_usd`, `trades_per_holder`, and how "
                     "closely buys and sells match.",
        criteria={"true": "Volume many times the token's own value, buys and sells in "
                          "near-identical counts, or many trades per holder.",
                  "false": "Volume plausible for the market cap, with a natural imbalance "
                           "between buys and sells."}),
}

PROJECT = {
    "effort": Score(
        instructions="Rate how much real work is visible behind this project, from "
                     "`name`, `description`, `website` and `x_handle` only. This is a "
                     "launch's own listing, not a review of the account.",
        criteria=["Nothing: no description, no website, or a single meme line.",
                  "Minimal: a generic one or two sentence pitch, little else.",
                  "Specific: a concrete description of what it is, plus a website.",
                  "Substantial: a detailed, specific product description, a website, and "
                  "a handle that matches the project's name."]),
    "copycat": Noul(
        instructions="This launch is riding someone else's name or a passing trend rather "
                     "than being its own project, judged from `name`, `ticker` and "
                     "`description`.",
        criteria={"true": "Named after a famous person, brand, app or news event; reuses a "
                          "well-known project's name; or the description could be pasted "
                          "onto any other coin.",
                  "false": "An original name and a description specific to this project."}),
}


def PICK(state: dict) -> dict:
    """Options are built at call time from the survivors' two-line summaries."""
    return {
        "best": Choice(
            instructions="Choose the single token in `candidates` that is the best entry "
                         "right now. Weigh launch shape, fake-volume risk, holder "
                         "concentration and project effort together. Prefer a clean setup "
                         "that has not run yet over a bigger move that already happened.",
            criteria={c["key"]: c["summary"] for c in state["candidates"]}),
        "worth_trading_at_all": Noul(
            instructions="At least one token in `candidates` is worth a position right now, "
                         "rather than all of them being mediocre.",
            criteria={"true": "At least one is a clean setup.",
                      "false": "Every candidate has a disqualifying weakness."}),
    }


SETS = {"market": MARKET, "project": PROJECT, "pick": PICK}
