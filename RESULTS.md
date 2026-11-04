# Results: crypto volatility forecast test

Pre-registered test: does a HAR volatility forecast predict next-day and next-7-day volatility better than "same as the last 30 days"? Plan: `preregistration-volatility-v1.0.md`. Data: 30 Coinbase USD coins, hourly candles, one locked year (2025-11-04 to 2026-11-03). Full output: `locked-run-results.txt`.

## Verdict
**PASS under the pre-registered rule.** The 7-day horizon decides.

| | 1-day | 7-day |
| --- | --- | --- |
| HAR improvement in mean QLIKE over the baseline (needed: at least 3%) | 23.73% | 21.35% |
| One-sided Diebold-Mariano p, Newey-West lag 6 (needed: below 0.05) | 0.0003 | 0.0178 |
| Coins better than the baseline (needed: at least 70%) | 30 of 30 | 26 of 30 |

Alongside, never deciding: EWMA (lambda 0.94) also beat the baseline (8.2% at 1 day, 10.6% at 7 days). The run without the spike rule is identical (the rule voided nothing in the locked year). The Parkinson-variance robustness run agrees (HAR 7-day: 21.8%, p = 0.0415).

## What to read with it
- **HAR over-forecast variance in the locked year.** The mean forecast-to-realised ratio was 1.19 at 7 days (range 1.00 to 1.41; 29 of 30 coins above 1.00) and 1.07 at 1 day. In the development run it was close to 1. QLIKE penalises under-forecasts more than over-forecasts, so HAR still won clearly while running high. The model was not recalibrated: a recalibrated version would be a new version, to be tested on forward data.
- **Four coins were worse than the baseline at 7 days:** SHIB (-15.6%), CRV (-6.1%), SEI (-3.6%), CRO (-1.8%). The pass mark allows this.
- **The 7-day p-value (0.0178) is moderate**, and a year of weekly windows contains only about 52 independent weeks.
- **Survivorship.** The 30 coins are those still tradable on Coinbase today, ranked by volume before the locked year. Delisted coins are missing.
- **Ticker-change effect.** RENDER (was RNDR), POL (was MATIC) and S (was FTM) are excluded only because Coinbase's current product starts after 2023-11-03.
- **One year, one regime.** The locked year is now used up for any further question about volatility ranges.

## What this does not show
- Anything about price **direction**. Direction tests on the same coins (separate work) were no better than a coin flip.
- Any trading profit.
- That the site's BUY / HOLD / SELL labels mean anything: after a BUY reading only 42% of days were up over the next 30 days in the earlier backtest.

## Order of events (GitHub server times, UTC, 2026-11-04)
- 09:19:13 pre-registration published (release `prereg-v1.0`, issue #1).
- 09:26 to 10:06 code tags `code-v1.0` to `code-v1.3` (issue #1); coin-selection preview run 41809225106; full data fetch, Action run 41809908288, from `code-v1.2`; data hashes posted 10:01:24.
- 10:08:48 first development run (bug-finding only).
- 10:18:15 a bug found in that run (Kraken median window in the spike rule) fixed in `code-v1.4`, before the locked year was opened.
- 10:19:35 locked year opened once, from `code-v1.4` (`locked-run.done`).
- 10:20:13 hashes of the results posted on issue #1, before any interpretation.

## Reproduce
```
node test.mjs
git show HEAD:SHA256SUMS.txt | sha256sum -c
OPEN_LOCKED_YEAR=yes node analyze.mjs --period locked   # refuses to run twice: locked-run.done exists
```

## Next
The range simulation (filtered historical simulation using this HAR forecast, unchanged) will be pre-registered and scored on forward data from a logger, because the locked year can no longer give a clean coverage test. See `IMPLEMENTATION-NOTES.md` and `variant-log.md`.
