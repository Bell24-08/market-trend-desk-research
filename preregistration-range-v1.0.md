# Pre-registration: 90% range for the next-day and next-7-day move, forward test

**Status: v1.0, final text, ready to hash. Not yet committed, nothing built or run.** The full file is committed to the public research repository as UTF-8 with LF line endings, its SHA-256 is posted on tracking issue #2 and the commit is published as a tagged GitHub Release. Both carry server-recorded times. After that this file is never edited; a change is a new version.

Crypto only. Gold has its own thread.

## Time convention
Times are given in WIB (UTC+7), with UTC in brackets. A data day is a UTC day, which runs from 07:00 WIB to 07:00 WIB the next day. For example, the data day 2026-11-06 ends at 07:00 WIB on 2026-11-07.

## 1. Question
Do 90% ranges for the next-day and next-7-day move, built from the frozen HAR volatility forecast and a filtered historical simulation, contain the realised move about 90% of the time? This is the coverage test promised in `preregistration-volatility-v1.0.md` section 8 (87-93%, Kupiec test). It could not be run on the locked year, which is used up, so it runs on new forward data only.

## 2. What is frozen
- **Forecasts:** the HAR forecasts F1 (1-day) and F7 (7-day) exactly as logged in the forward ledger (`preregistration-forward-v1.0.md`), with no recalibration. A stable forecast bias cancels under standardisation (past returns are divided by the forecast made at the time and the result is scaled by today's forecast); this test shows whether the bias is stable.
- **Coins and data:** the same 30 coins, Coinbase daily closes (UTC days), the same void rules.
- **Historical forecasts used in the pool.** For days before D0 (data day 2026-11-06) the pool uses the frozen model's own walk-forward forecasts (`lib.forecastCoin`, hourly target, voids as defined) with refit dates D0 minus 30 x k days (k = 14, 13, ..., 1) and D0, so that its refit schedule coincides with the forward ledger's. For days from D0 on, the pool uses the ledger values. On days from D0 onward the walk-forward forecast and the ledger value must be identical; a mismatch is a bug and is reported.
- **Method (filtered historical simulation), for coin c and forecast day t:**
  1. **1-day pool.** For each of the 365 data days s ending at t, z_s = ln(P_s / P_(s-1)) / sqrt(F1_s), where P are Coinbase daily closes and F1_s is the HAR 1-day variance forecast made at the end of day s-1 for day s, out of sample (see above). A day with a void, a missing forecast or a missing daily candle is left out. If fewer than 330 valid days remain, no 1-day range is produced for that coin-day and the gap is reported.
  2. **7-day pool.** The 365 overlapping 7-day windows ending on or before t: for each window starting after day s, y_s = ln(P_(s+7) / P_s) / sqrt(F7_s), where F7_s is the HAR 7-day variance forecast made at the end of day s. Windows with a void or missing forecast or candle are left out; fewer than 330 valid windows means no 7-day range and a reported gap. Overlap inside a resampling pool is accepted.
  3. **No drift.** Each pool's mean is subtracted.
  4. **1-day range.** Draw 10,000 values z* with replacement from the 1-day pool; the simulated 1-day log return is sqrt(F1_t) x z*, where F1_t is the ledger forecast for day t+1. The range is the 5th to 95th percentile.
  5. **7-day range.** Draw 10,000 values y* with replacement from the 7-day pool; the simulated 7-day log return is sqrt(F7_t) x y*. The range is the 5th to 95th percentile.
  6. **Seed.** Per coin-day and horizon: 19 + 1000 x (data-day index of t) + (coin index in `coins.json`) + (0 for 1 day, 500000 for 7 days), with the project's mulberry32 generator.
- **Not tuned.** The pool window (365 days), the removal of drift, the 10,000 draws and the seed are standard choices and were not tuned on any data. No coverage of these ranges has been computed on any data before this document is published.
- **Logged** as `type: "range"` rows in the same append-only ledger: coin, horizon, t, the two log-return bounds, the forecast used, the number of valid pool entries, the SHA-256 of the standardised pool and the seed. Scores are logged as `type: "range_score"` rows.
- **Code:** a new tagged runner version adds the range rows. The v1 prediction rows are unchanged (a test checks that the same inputs give byte-identical prediction rows). The model file `lib.mjs` stays byte-identical to `code-v1.4`.

## 3. Scoring
- **Realised move:** the log return of the Coinbase daily close from t to t+h (h = 1 or 7). A forecast whose target window contains a void day or a missing daily candle is not scored.
- **Inside** means lower bound <= realised move <= upper bound.
- **The 1-day horizon decides.** Minimum 12 months of forecasts: 365 forecast days per coin. The 7-day horizon is reported on non-overlapping weeks (every 7th forecast day, about 52 per coin) as description only.
- **Per coin:** the coverage, a Kupiec test of coverage = 90% at alpha 0.05, and (reported only, not part of the pass rule) a Christoffersen independence test of the hit sequence.
- **Pooled:** coverage over all coin-days, with a 95% interval from a by-date block bootstrap (whole weeks of dates, all coins together, seed 19, 5,000 resamples). The pass rule uses the pooled point estimate; the bootstrap interval is reported alongside.
- **Pass rule:** pooled coverage between 87% and 93%, and at least 80% of coins pass the Kupiec test.
- **Reading:** above 93% means the ranges are too wide; below 87% too narrow. The lower and upper breach rates (each about 5% if the ranges are right) show which side. No direction of failure is assumed in advance.
- **Reported alongside:** coverage by month, results with and without void days, the missed forecast days, and the number of coin-days without a range. Coverage on the locked year may be reported after publication, labelled "not a clean test".
- **No early stopping.** One formal verdict, computed by the run on the day fixed in section 4.

## 4. Dates
- **D1** is the first forecast day with ranges. D1 = D0 = data day **2026-11-06** (ending 07:00 WIB on 2026-11-07), provided the range runner is tagged before 00:00 UTC on 2026-11-07 (07:00 WIB). Otherwise D1 is the first data day that starts after the tag. Ranges need the ledger forecast for t, so D1 cannot be earlier than D0.
- Forecast days are D1 to D1+364 (365 days). The last 1-day target day is D1+365. The formal verdict is computed by the run at **07:30 WIB on D1+367** (00:30 UTC), one full day after the last target day completes. With D1 = 2026-11-06 this is **2027-11-08**.
- If D1 moves, every date in this section shifts by the same number of days and a dated note is posted on tracking issue #2. No other change of dates is allowed.

## 5. What this does not test
Recalibration of the forecast, other probability levels, direction, or any trading use. A recalibrated model would be a new version, run as a shadow, with its own pre-registration.

## 6. Known risks
- **Ledger gaps** reduce the pools; the 330-entry minimum means a coin-day without enough valid history produces no range, and the gap is reported.
- **Mixed forecast source in the pool** (walk-forward before D0, ledger after) is stated, checked for equality from D0 onward, and visible through the pool hash.
- **GitHub scheduling risks** as in the forward pre-registration.

## 7. Counting
Adds one variant to `variant-log.md`: V6, the filtered-historical-simulation 90% range (1-day and 7-day). No other strategy is added.
