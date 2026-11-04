# Forward logger

Implements `preregistration-forward-v1.0.md`. `runner.mjs` is run daily by `.github/workflows/forward.yml` at 07:30 WIB (00:30 UTC). `test.mjs` must pass before every run. `q3.mjs` computes the descriptive Q3 table.

Files written by the runner, all append-only: `data/` (hourly and daily Coinbase candles per coin), `data-kraken/` (Kraken daily candles for the spike rule), `ledger/YYYY-MM.jsonl` (predictions and scores), `digests.jsonl` (the digest chain), plus `scorecard.json` and `latest.json`, which are rewritten daily and are not part of the ledger.

The model code is `../lib.mjs`, byte-identical to tag `code-v1.4` (SHA-256 in `runner.mjs`, checked at the start of every run).

Verify the ledger yourself: recompute each digest line from `digests.jsonl` (`digest = SHA-256(prev + rows_sha)`), check `rows_sha` against the lines named in the entry, and compare each digest with the comment the Action posted on issue #2.

Monthly: make one manual commit so GitHub does not disable the schedule after 60 days of inactivity, and check that every day has its issue comment.
