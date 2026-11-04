# Market Trend Desk research record

Pre-registered tests for the Market Trend Desk crypto forecasts. Simulated results only; this is not financial advice and nothing here places an order.

Files:
- `preregistration-volatility-v1.0.md`: the full plan for the crypto volatility test. Never edited after it is published; a change becomes a new version.
- `variant-log.md`: every strategy tried so far, kept up to date before any new test is run.
- `.gitattributes`: forces LF line endings so the SHA-256 of each file is the same on every machine.

Order of steps (each step's hash is posted as a comment on the same GitHub issue, which gives a server-timed record):
1. Pre-registration published (this file's SHA-256 posted in an issue, commit published as a tagged GitHub Release).
2. Code tag: fetch script and analysis code committed and tagged.
3. Data fetch (GitHub Action): resolved coin list and SHA-256 of every data file committed. The locked year sits in its own file that the development-run code never reads.
4. Development run (bug-finding only).
5. Locked run (one time).

To check a file: `sha256sum preregistration-volatility-v1.0.md` on the committed file gives the number posted in the issue.
