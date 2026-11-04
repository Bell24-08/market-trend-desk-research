// node analyze.mjs --period dev                 bug-finding run on the development period only (never reads data/locked)
// OPEN_LOCKED_YEAR=yes node analyze.mjs --period locked   the one-time locked-year run (refuses to run twice)
// Options: --target parkinson (robustness check), --no-voids (report without the spike rule). Implements preregistration-volatility-v1.0.md.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildSeries, forecastCoin, aggregate, verdict, horizonPasses, dayIndex } from "./lib.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; }, has = (k) => process.argv.includes(k);
const period = arg("--period"), START = "2023-11-04", DEV_END = "2025-11-03", LOCK_START = "2025-11-04", LOCK_END = "2026-11-03";
if (!["dev", "locked"].includes(period)) { console.log("Usage: node analyze.mjs --period dev|locked [--target parkinson] [--no-voids]"); process.exit(1); }
if (period === "locked") {
  if (process.env.OPEN_LOCKED_YEAR !== "yes") { console.log("The locked year is opened once. Set OPEN_LOCKED_YEAR=yes to confirm."); process.exit(1); }
  if (existsSync("locked-run.done")) { console.log("locked-run.done exists: the locked year was already opened. A repeat run is only allowed after a logged bug fix (delete nothing; add a new version)."); process.exit(1); }
}
const decision = JSON.parse(readFileSync("target-decision.json", "utf8")), coins = JSON.parse(readFileSync("coins.json", "utf8")).selected.map((c) => c.symbol);
const target = arg("--target") || decision.target, applyVoids = !has("--no-voids");
const nDays = dayIndex(period === "dev" ? DEV_END : LOCK_END, START) + 1, scoreStart = period === "dev" ? 0 : dayIndex(LOCK_START, START), scoreEnd = nDays - 1;
const anchorIdx = period === "dev" ? null : dayIndex(DEV_END, START);

const load = (path) => (existsSync(path) ? gunzipSync(readFileSync(path)).toString().trim().split("\n").slice(1).map((l) => l.split(",").map(Number)) : []);
const rowsOf = (kind, sym) => { const a = load(`data/dev/${sym}-${kind}.csv.gz`); return period === "locked" ? a.concat(load(`data/locked/${sym}-${kind}.csv.gz`)) : a; };
const per = { 1: {}, 7: {} };
for (const sym of coins) {
  const kraken = load(`data/kraken/${sym}-daily.csv.gz`), series = buildSeries({ daily: rowsOf("daily", sym), hourly: target === "hourly" ? rowsOf("hourly", sym) : null, kraken }, { start: START, nDays, target });
  for (const h of [1, 7]) per[h][sym] = forecastCoin(series, h, { applyVoids, anchorIdx, scoreStart, scoreEnd });
}
const lines = [], say = (s = "") => { console.log(s); lines.push(s); };
const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
say(`Period: ${period}${period === "dev" ? " (bug-finding only, does not decide the verdict)" : " (locked year, decides the verdict)"}. Target: ${target}. Spike voids ${applyVoids ? "applied" : "NOT applied"}. Coins: ${coins.length}.`);
const res = {};
for (const [key, label] of [["lHar", "HAR (primary)"], ["lEw", "EWMA 0.94 (secondary, never decides)"]]) for (const h of [1, 7]) {
  const r = aggregate(per[h], key); res[`${key}${h}`] = r;
  say(`\n${label}, ${h}-day horizon: ` + (r ? `${r.days} scored days. Mean QLIKE baseline ${f(r.meanBase)} vs model ${f(r.meanModel)} (improvement ${f(100 * r.improvement, 2)}%). DM t=${f(r.dm.t, 2)}, p=${f(r.dm.p)}. Coins better: ${r.coinsBetter}/${r.coinsScored} (${f(100 * r.shareBetter, 0)}%).${key === "lHar" ? " Pass mark " + (horizonPasses(r) ? "MET" : "not met") : ""}` : "no scored days"));
}
say(`\nVerdict (HAR, pass mark: improvement >= 3%, DM p < 0.05 with Newey-West lag 6, >= 70% of coins better; 7-day decides): ${verdict(res.lHar1, res.lHar7)}`);
say(`Number of qualifying coins: ${coins.length}`);
if (period === "locked") { writeFileSync("locked-run-results.txt", lines.join("\n") + "\n"); writeFileSync("locked-run.done", `locked year opened ${new Date().toISOString()} target=${target} voids=${applyVoids}\n`); }
else writeFileSync(`dev-run-results${target !== decision.target ? "-" + target : ""}${applyVoids ? "" : "-no-voids"}.txt`, lines.join("\n") + "\n");
