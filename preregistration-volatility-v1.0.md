# Pre-registration: crypto volatility forecast test

Status: v1.0, final text, ready to hash. Not yet committed anywhere, nothing run, nothing locked. v0.3 is replaced by this version. The full file is committed to a public repository as UTF-8 with LF line endings and no byte-order mark (a `.gitattributes` line `*.md text eol=lf` enforces this), and its SHA-256 is computed from the committed file in the repository, so anyone checking gets the same number.

Proof of when it was written: the SHA-256 is posted in a GitHub issue in the same repository, and the commit is published as a tagged GitHub Release. Both carry server-recorded times that cannot be backdated. Git commit dates alone are not relied on.

After that this file is never edited; a change becomes a new version and counts as a new variant in the variant log.

Crypto only. Gold has its own thread.

## 1. Question
Does a HAR volatility forecast predict next-day and next-7-day crypto volatility better than "same as the last 30 days"?

Volatility is tested first because it clusters and is far more forecastable than direction. A pass would feed the page's ranges and a "stay out when wild" rule. It says nothing about up or down.

## 2. Coins and exchange (volatility test only)
- One exchange only: Coinbase (USD pairs). Reason: Kraken's public API returns only the latest 720 candles per call (about 30 days of hourly data and about 2 years of daily data), too short for a 3-year test. A coin that is not on Coinbase with enough history is not in the test.
- Exclusions are applied first. Excluded, by rule only: stablecoins, wrapped tokens, gold-backed tokens (PAXG, XAUT), leveraged tokens, tokenized stocks, real-world-asset tokens, any coin whose first daily Coinbase candle is after 2023-11-03 (less than 3 years of history), and any coin whose USD pair is no longer active (it cannot be fetched).
- The test uses the top 30 remaining coins by USD volume, computed as the sum over the 90 days ending 2025-11-03 (UTC) of daily volume x daily close, from Coinbase daily candles. That window ends the day before the locked year starts, so the list does not depend on anything inside the locked year.
- No other exclusions. No judgment calls (for example "too much of a memecoin"). If fewer than 30 qualify, use all that do. The number of qualifying coins is reported with the verdict; the pass mark is unchanged.
- Caveat: coins still tradable today are survivors, and coins delisted since 2023 are missing. Survivorship bias matters little for volatility forecasting but is stated here. The later direction test uses a different, point-in-time list.

## 3. Target and data (decided by data availability, before seeing any result)
1. In one run of a one-off script (a GitHub Action in the same public repository), fetch for 2023-11-04 to 2026-11-03 UTC: hourly and daily Coinbase candles for every coin, and Kraken daily candles for the coins that have a Kraken USD pair (used only by the spike rule in section 5). Do not analyse anything.
2. After fetching, commit the resolved coin list and the SHA-256 of every data file (development period, locked year, and the Kraken daily data) before any analysis. Kraken is included because it decides which locked-year days are voided.
3. A day runs 00:00 to 24:00 UTC. All 7 days of the week are used. Annualise with sqrt(365).
4. Coverage = share of coin-days in that range with at least 22 of 24 hourly candles.
   - One decision for all coins at once. If coverage is at least 95% across the whole list: target = hourly realised variance for every coin, RV(day) = sum of the 24 squared hourly log returns. A day has 24 returns from 25 closes (the first return starts at the previous day's 23:00 close). Returns are taken between consecutive available closes, so a missing hour still leaves the day covered.
   - Otherwise: target = Garman-Klass variance for every coin, from Coinbase daily candles: 0.5*ln(H/L)^2 - (2*ln2 - 1)*ln(C/O)^2. Estimators are never mixed across coins.
   - Expect hourly coverage to fail for thin coins, in which case Garman-Klass applies to all.
5. Void days: a coin-day with more than 2 missing hours (hourly target) or with high equal to low (zero range) is void. The target is floored at 1e-10.
6. The same estimator is used for the model inputs, the target and the baseline.

## 4. Models
- Primary claim: HAR on log target. log RV(t+1) = b0 + b_d*log RV_1d + b_w*log RV_7d + b_m*log RV_30d (windows are means over 1, 7 and 30 days). A window mean needs at least 80% of its days present, otherwise that day is not forecast or scored. A void day replaced by the trailing median (section 5) counts as present in input windows; a day with no data counts as absent. OLS on an expanding window per coin, minimum 365 training days. Forecast = exp(fitted + 0.5*residual variance). For the 7-day horizon: a separate HAR on the sum of the next 7 days.
- Training cutoff: a training row is used only if its full target window (1 day or 7 days) ended on or before the forecast date.
- Anchoring: the first fit for the locked year is made on 2025-11-03 using all data from each coin's start; refits follow every 30 days from then through the locked year. EWMA is initialised with the first 30-day mean.
- Baseline: mean of the target over the previous 30 days. For the 7-day horizon: 7 times that mean.
- Secondary (reported, never used to pass or fail): EWMA with lambda = 0.94 on the target series. For 7 days: 7 times the one-day forecast. No other lambda is tested.
- Horizons: next day and next 7 days.

## 5. Spike rule (kept narrow)
- A coin-day is flagged if its range is more than 5 times that coin's trailing 30-day median daily range. For hourly realised variance this is stated in variance terms: more than 25 times the trailing 30-day median daily variance.
- A flagged day is voided only if it is a single-exchange wick: the coin has a Kraken USD pair, the Kraken data fetched in section 3 covers that day, and Kraken's range for that day is less than 2 times its own trailing 30-day median. If the coin is not on Kraken or the day is not covered, the day is kept. Real crash days are the hardest and most important test cases.
- Kraken coverage: its 720 daily candles, fetched in November 2026, reach back to about mid-November 2024, which covers the whole locked year. Early development-period days can therefore never be voided. This is accepted, because the development period does not decide the verdict.
- A void day is excluded from scoring. In the input windows it is replaced by the median of the coin's trailing 30 days, taken over non-void days only.
- The rule is applied by code. Voids are logged. No data is edited after results exist. Results are reported both with and without voids.

## 6. Time split, frozen code and what each period is for
- Locked year: 2025-11-04 to 2026-11-03 UTC. Fetched in the same run as everything else, hashed, and not touched: no statistics, not even summaries.
- Development period (before 2025-11-04): models may be run here to find bugs, regardless of results. Parameters in section 4 are fixed and are not tuned on it. Its results are reported but never decide the verdict.
- Frozen code: the fetch script and the analysis code are committed and tagged before the development run. The locked-year run uses the code at that tag. Any change after that is a logged bug fix, handled as below.
- The verdict comes from the locked year alone. The locked year is opened once. If a bug is found after that run, it is fixed, the run is repeated, and both versions are reported; a changed model is a new version and a new variant.
- Commit order in one public repository, which is what proves the sequence: (1) this pre-registration, (2) the code tag, (3) the data fetch with the coin list and data hashes, (4) the development run, (5) the locked run. The hash of each step (this document, the code tag, the data hashes, the development-run output, the locked-run output) is posted as a comment on the same GitHub issue, which gives one public, server-timed record of the whole sequence.
- The locked-year data is kept in its own file, at a path the development-run code never reads, so that "not touched" can be checked and not only promised.
- The coin list the rule in section 2 produces is shown for review before the development run, because it is the first output where a rule could behave differently from what was intended.

## 7. Scoring and pass mark (locked year, HAR vs baseline)
- Loss: QLIKE = RV/F - ln(RV/F) - 1, with RV the realised target and F the forecast.
- A 7-day forecast is scored only if its whole target window ends on or before 2026-11-03.
- The scored series: for each day, the average QLIKE across the coins available that day. The 3% test and the Diebold-Mariano test use this same series, with voids applied.
- All of the following must hold at a horizon for HAR to count as having skill there:
  1. Mean QLIKE over the year is at least 3% lower than the baseline's (1 - HAR/baseline >= 0.03).
  2. One-sided Diebold-Mariano test at alpha = 0.05 on the daily loss difference (baseline minus HAR), Newey-West standard errors with lag 6 for both horizons.
  3. At least 70% of coins individually improve; a coin improves if its mean QLIKE is below the baseline's by any amount.
- Overall verdict:
  - 7-day passes and 1-day passes: pass.
  - 7-day passes and 1-day fails: pass, with the 1-day horizon reported as inconclusive.
  - 7-day fails: fail, whatever happens at 1-day.
- Reported alongside, not part of pass/fail: EWMA results; Parkinson variance as a robustness check; development-period results; results without voids applied; the number of qualifying coins.

## 8. Range coverage (fixed here, method defined in its own document before it is run)
The 90% range from the later filtered-historical-simulation step must contain the outcome 87-93% of the time on closing prices, with a Kupiec test p > 0.05, scored on the locked year. These thresholds are fixed now and will not be adjusted later. That document must test per coin or on non-overlapping windows, because correlated coins and overlapping 7-day windows break the Kupiec test's independence assumption.

## 9. Direction test (separate pre-registration)
Coin list chosen point-in-time each month (top 30 by trailing 90-day volume using only data available then), returns measured against the crypto average, scored by log loss and return correlation. Not part of this document.

## 10. Counting
Every variant tried is logged in the variant log before it is run. So far: 18 distinct crypto strategies, plus design choices fixed after seeing results (the 11 inputs, 35-day retraining, 0.55/0.45 call thresholds, 1-day and 7-day horizons). The first +21.6% wallet run is logged separately as a selected result. No clean historical hold-out exists for direction.

## Open item
- Which public repository receives the commit and runs the fetch (nothing is pushed without the owner's say-so).
