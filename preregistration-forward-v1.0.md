# Pre-registration: forward test of the volatility forecast and the trend reading

**Status: v1.0, final text, ready to hash. Not yet committed, nothing built or run.** The full file is committed to the public research repository as UTF-8 with LF line endings, its SHA-256 is posted on tracking issue #2 and the commit is published as a tagged GitHub Release. Both carry server-recorded times. After that this file is never edited; a change is a new version.

Crypto only. Gold has its own thread.

## Time convention
Times are given in WIB (UTC+7), with UTC in brackets. A data day is a UTC day, which runs from 07:00 WIB to 07:00 WIB the next day. For example, the data day 2026-11-03 ends at 07:00 WIB on 2026-11-04. Data days stay in UTC because the exchange candles, the frozen code and GitHub's scheduler all use UTC; moving them to WIB midnight would change the data and the model that passed.

| Event | WIB | UTC |
| --- | --- | --- |
| A data day starts and ends | 07:00 | 00:00 |
| Daily logger run | 07:30 | 00:30 |
| Retry deadline for an incomplete day | 09:00 | 02:00 |
| GitHub cron setting | written in UTC (`30 0 * * *`, with the comment `# 07:30 WIB`) | 00:30 |

## 1. Why a forward test
The locked-year test of the volatility forecast passed (see `RESULTS.md`), but the locked year is now used up: any range method or recalibration chosen after seeing it cannot be tested on it cleanly. New data that nobody has seen is the only clean test, and only time produces it. The direction question has no clean historical hold-out left either.

## 2. Questions
1. **Q1 (decides):** does the frozen HAR volatility forecast keep beating the 30-day baseline on new data?
2. **Q2 (descriptive):** is the over-forecast seen in the locked year (mean forecast / realised variance 1.19 at 7 days, 1.07 at 1 day) stable? Reported, not corrected.
3. **Q3 (descriptive only, no pass mark):** what do 7-day returns look like after each trend reading (up, mixed, down), compared with all coin-days? No claim of predictive power is tested.

## 3. What is frozen
- **Forecast model:** HAR exactly as in `preregistration-volatility-v1.0.md` section 4: hourly realised variance target, HAR on log variance with 1, 7 and 30-day windows, expanding window per coin, OLS, forecast = exp(fitted + 0.5 x residual variance), minimum 365 training days. Baseline: 30-day mean (7-day: 7 times). EWMA 0.94 is logged as secondary. Training data is all data to date: development, locked and forward. The first fit is made on the first forecast day D0 and refits follow every 30 days (D0+30, D0+60, ...).
- **The model code is frozen by hash.** The forward runner imports `lib.mjs` byte-identical to tag `code-v1.4`, SHA-256 `5c2a129c88d8ff2df5cedbfe1542d6f3c80b68a9723df4dcc7ef7aa62435e33a`, and checks this hash at the start of every run. A mismatch aborts the run visibly.
- **Coins:** the same 30 coins as `coins.json`. No coin is added or removed, even if it is delisted (a delisted coin stops being scored from its last complete day and the gap is reported).
- **Exchange and data rules:** Coinbase USD pairs; coverage, void and spike rules as in the volatility pre-registration (sections 3 and 5), including the Kraken single-exchange-wick confirmation.
- **Trend reading:** the site's five-check score (price above 200-day average, 50-day above 200-day, 20-day above 50-day, higher than 30 days ago, RSI between 40 and 70). 4 or 5 = up, 2 or 3 = mixed, 0 or 1 = down. It is computed from the same Coinbase daily closes (UTC days) as everything else here; the live site may use other exchange data, so its reading can differ slightly. Logged only for Q3.
- **Runner code:** committed and tagged `forward-v1.0` before its first run. A change after that is a logged bug fix; any change to the model is a new version that runs in parallel as a shadow and never replaces v1.
- **The site shows forecasts from the ledger only.** If the site later displays the HAR "typical move", it reads the stored forecast from this ledger and does not compute its own. What users see is exactly what is being tested.

## 4. Dates (fixed now)
- **D0 = data day 2026-11-06**, ending 07:00 WIB on 2026-11-07 (00:00 UTC). Forecast days are D0 to D0+364, that is **2026-11-06 to 2027-11-05**: 365 forecast days.
- The first run that makes predictions is the run at **07:30 WIB on 2026-11-07** (00:30 UTC), with data day D0 as its last complete day.
- The last 7-day target window ends on data day D0+371 = **2027-11-12** (ending 07:00 WIB on 2027-11-13). The formal verdict is computed by the run at **07:30 WIB on 2027-11-14** (00:30 UTC), one full day after that data day completes, so that back-filled data for the last day is settled and the verdict does not depend on how complete the data happens to be that morning.
- **If the runner is not tagged `forward-v1.0` before 00:00 UTC on 2026-11-07 (07:00 WIB), D0 moves to the first data day that starts after the tag, a dated note is posted on tracking issue #2, and every date in this section shifts by the same number of days.** No other change of dates is allowed.

## 5. What is logged, and when
- **Runner:** a scheduled GitHub Action in the research repository, daily at 07:30 WIB (00:30 UTC).
- **Each run, in this order:** (1) check the `lib.mjs` hash; (2) fetch the newly completed UTC days (hourly and daily Coinbase candles, Kraken daily candles) for the 30 coins and append them to the forward data files; (3) score every earlier prediction whose target window has ended; (4) write the new predictions; (5) update the ledger, the digest chain and the scorecard; (6) commit the files and post the day's digest as a comment on tracking issue #2.
- **Incomplete day at run time:** if the last complete day t has fewer than 22 hourly candles for a coin when the run starts, the run retries until 09:00 WIB (02:00 UTC). If the day is still short, the prediction is made from what is available and the row records the hour count. Later back-fill may complete the data used for scoring but never changes a prediction.
- **A prediction row has:** formula version (tag), coin, horizon (1 or 7 days), the last complete day t used (`data_as_of`), the hour count of day t, the target window (t+1 to t+h), the HAR forecast F, the baseline, the EWMA value, the trend score and reading, the last close, the SHA-256 of the input window, and `made_at` (server time).
- **Inputs:** a forecast uses only completed UTC days up to t. Hours of day t+1 that have already passed when the run starts are never used, and the input hash proves which data was used.
- **Predictions are never rewritten or back-filled.** If a day's run does not happen, no prediction exists for that day; data may be back-filled, predictions may not. Missed days are reported by date together with that day's realised volatility (taken from later back-filled data), because outages and GitHub delays may cluster on volatile days.

## 6. Tamper evidence
- **Append-only ledger** under `forward/`: one file per month, JSON lines. Before writing, the runner checks that every earlier file still matches its stored digest and aborts the run visibly if not. This check only catches accidents, because the stored digests live in the same repository the runner writes to.
- **The real protection is the daily comments.** Day digest = SHA-256(previous digest + SHA-256 of that day's rows). The Action posts each day's digest as a comment on tracking issue #2, which gives a GitHub server timestamp for every day. Anyone can verify the ledger by recomputing the chain against those comments.
- **Public:** the repository is public, the data files are committed, and the scoring code is the tagged code.

## 7. Scoring
- **Q1 pass mark, identical to the volatility pre-registration section 7:** QLIKE improvement of HAR over the baseline of at least 3% on the daily cross-coin average, one-sided Diebold-Mariano test at alpha 0.05 with Newey-West lag 6, and at least 70% of coins individually better; the 7-day horizon decides, a 1-day fail alone is reported as inconclusive.
- **When:** the formal verdict is computed once, by the run of 2027-11-14 (section 4), using all 365 forecast days. Interim scorecards (published daily) are descriptive and carry no verdict. There is no early stopping for success or failure.
- **Reported alongside:** the mean forecast-to-realised ratio per horizon and coin, results with and without voided days, EWMA results, the number of coins still scored, and the missed days.
- **Power:** one year of data gives about the same power as the locked-year test, so the 7-day test passes only if the improvement is about as large as before. A fail with HAR still better than the baseline means "not confirmed", not "volatility forecasting does not work".
- **Q3:** for each reading (up, mixed, down) **and for all coin-days regardless of reading** (the comparison): the number of coin-days, the mean and median 7-day return, and the share of days up. The 95% interval uses a block bootstrap that resamples whole weeks across all coins together (seed 19, 5,000 resamples), because overlapping windows and coins that move together make a simple interval far too narrow. The effective number of independent observations is about one seventh of the row count.

## 8. What this does not test
Direction as a trading signal, any trading profit, or the site's wording. A pass says the volatility forecast keeps working on unseen data, nothing more. A fail or a "not confirmed" is reported plainly.

## 9. Known risks
- **GitHub schedules:** runs can start late. On a public repository, scheduled workflows can be disabled after 60 days without repository activity. It is not certain that commits made by the Action itself count as activity, so they are not relied on: one manual commit is made each month (with a reminder set), and the daily issue comment, expected between 07:30 and 09:00 WIB, is the heartbeat. A day without one is investigated within 48 hours. A stopped schedule is reported, not hidden.
- **Exchange changes:** an API change, a delisting or a candle revision is logged as a gap or revision in the ledger; nothing is edited afterwards.
- **Survivorship:** the coin list is today's; see `RESULTS.md`.

## 10. Later pre-registrations (not part of this document)
The range simulation (filtered historical simulation using this forecast, unchanged) with its coverage test (87-93%, Kupiec test) gets its own pre-registration and is added to the logger as a new version only after that document is published.

## 11. Counting
Every variant is logged in `variant-log.md` before it runs. This test adds no new strategy: it re-uses V1-V5 from the volatility test and the trend rule.
