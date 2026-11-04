# Variant log (crypto)

Every distinct strategy or design choice tried on crypto history, in order. Count **distinct strategies, not runs**: re-running one variant on more dates or coins is one variant. Add a line before running anything new. Gold is logged in its own thread.

Why this exists: the more variants tested on the same history, the more likely one "passes" by luck. Any future pass has to be read against this count.

## Logged so far (as of 2026-11-04)

| # | Date | Variant | Data / coins | Result (short) | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | early | Five-check trend score (price>200d, 50d>200d, 20d>50d, up vs 30 days ago, RSI 40-70) | 6 coins, 5 yrs | no predictive edge | definition chosen before testing |
| 2 | early | BUY/HOLD/SELL thresholds 4-5 / 2-3 / 0-1 | same | thresholds chosen after seeing score distribution | a design choice, count it |
| 3 | early | Old site signals (20/50 cross + RSI turns) | 6 coins | lost in last 40% | `backtest.mjs` |
| 4 | early | Trend: 20-day above 50-day | 6 coins | beat hold on 4/6, still ~+6% in last 40% | |
| 5 | early | Trend: price above 200-day | 6 coins | beat hold 5/6, -8% in last 40% | |
| 6 | early | Score BUY>=3 / SELL<=2 | 6 coins | worse | |
| 7 | early | Score BUY>=4 / SELL<=2 | 6 coins | worse | |
| 8 | early | RSI bounce (buy <30, sell >60) | 6 coins | beat hold 3/6 | |
| 9 | early | Bootstrap simulation, next-hour band, drift kept vs drift removed | 11 assets, 5 hrs | band ~85% (9-in-10), ~47-51% (middle half) | drift removal chosen after seeing direction lean was wrong |
| 10 | 2026-11 | Paper test: trend-check call, 6 assets, 5 min | live | not meaningful | `papertest.mjs` |
| 11 | 2026-11 | Paper test: 10 XRP accounts, short if Buy% <= 50 | live | 7/10 direction right, -0.01% after fees | `papertest10.mjs` |
| 12 | 2026-11 | Model A (logistic) next-7-day direction, 11 scale-free inputs, thresholds 0.55/0.45 | 5 coins, daily | 46-58% | `crypto-prob-test.mjs` |
| 13 | 2026-11 | Model B (boosted one-split trees) next-7-day | same | 47-58% | |
| 14 | 2026-11 | Model A next-day | same | 49-54% | |
| 15 | 2026-11 | Model B next-day | same | 49-54% | |
| 16 | 2026-11 | F1 momentum, 5-min horizon | ETH, XRP, minutes | ~50% | `minute-live-test.mjs` |
| 17 | 2026-11 | F2 fade the move, 5-min | same | ~50% | |
| 18 | 2026-11 | F3 EMA(5)>EMA(20), 5-min | same | 39-60%, noise | |

Design choices fixed after looking at results (cannot be removed by walk-forward): the 11 inputs, 35-day retraining, 0.55/0.45 call thresholds, 1-day and 7-day horizons.

Selected and reported result (log separately, do not cite alone): first wallet run, 10 trades per coin from one set of dates, +21.6% long/short. Repeating from 14 start dates gave a median of about +1%. The first run was a lucky draw.

Distinct strategies so far: 18 (plus the design choices above). Earlier I said "about 40"; that counted runs, not strategies.

## Rules from here
- New idea = new row, written **before** it is run.
- Changing any parameter after seeing a result = a new variant.
- Gold-related variants go in the gold thread's log, not here.
- Direction tests have already used the whole history up to 2026-10-30. There is no clean historical hold-out for direction; only the forward logger can confirm it.
