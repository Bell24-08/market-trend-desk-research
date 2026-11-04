// node analyze.mjs --period dev                 bug-finding run on the development period only (never reads data/locked)
// OPEN_LOCKED_YEAR=yes node analyze.mjs --period locked   the one-time locked-year run (refuses to run twice)
// One call computes everything the pre-registration reports: the main result (target from target-decision.json, spike rule applied) that decides the verdict,
// plus EWMA (secondary), the run without voids and the Parkinson-variance run (robustness, reported only). Implements preregistration-volatility-v1.0.md.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildSeries, forecastCoin, aggregate, verdict, horizonPasses, dayIndex } from "./lib.mjs";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const period = arg("--period"), START = "2023-11-04", DEV_END = "2025-11-03", LOCK_START = "2025-11-04", LOCK_END = "2026-11-03";
if (!["dev", "locked"].includes(period)) { console.log("Usage: node analyze.mjs --period dev|locked"); process.exit(1); }
if (period === "locked") {
  if (process.env.OPEN_LOCKED_YEAR !== "yes") { console.log("The locked year is opened once. Set OPEN_LOCKED_YEAR=yes to confirm."); process.exit(1); }
  if (existsSync("locked-run.done")) { console.log("locked-run.done exists: the locked year was already opened. A repeat run is only allowed after a logged bug fix (delete nothing; add a new version)."); process.exit(1); }
}
const decision = JSON.parse(readFileSync("target-decision.json", "utf8")), coins = JSON.parse(readFileSync("coins.json", "utf8")).selected.map((c) => c.symbol);
const nDays = dayIndex(period === "dev" ? DEV_END : LOCK_END, START) + 1, scoreStart = period === "dev" ? 0 : dayIndex(LOCK_START, START), scoreEnd = nDays - 1;
const anchorIdx = period === "dev" ? null : dayIndex(DEV_END, START);

const load = (path) => (existsSync(path) ? gunzipSync(readFileSync(path)).toString().trim().split("\n").slice(1).map((l) => l.split(",").map(Number)) : []);
const rowsOf = (kind, sym) => { const a = load(`data/dev/${sym}-${kind}.csv.gz`); return period === "locked" ? a.concat(load(`data/locked/${sym}-${kind}.csv.gz`)) : a; };
const cache = Object.fromEntries(coins.map((s) => [s, { daily: rowsOf("daily", s), hourly: decision.target === "hourly" ? rowsOf("hourly", s) : null, kraken: load(`data/kraken/${s}-daily.csv.gz`) }]));
const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "n/a"), lines = [], say = (s = "") => { console.log(s); lines.push(s); };

function run(title, target, applyVoids, decides) {
  const per = { 1: {}, 7: {} }, res = {}; let voids = 0, flagged = 0;
  for (const sym of coins) {
    const series = buildSeries(cache[sym], { start: START, nDays, target }); voids += series.spike.filter(Boolean).length + series.structVoid.filter(Boolean).length;
    for (const h of [1, 7]) per[h][sym] = forecastCoin(series, h, { applyVoids, anchorIdx, scoreStart, scoreEnd });
  }
  say(`\n=== ${title} (target ${target}, spike rule ${applyVoids ? "applied" : "NOT applied"}, void coin-days counted: ${voids}) ===`);
  for (const [key, label] of [["lHar", "HAR"], ["lEw", "EWMA 0.94"]]) for (const h of [1, 7]) {
    const r = aggregate(per[h], key); res[`${key}${h}`] = r;
    say(`${label}, ${h}-day: ` + (r ? `${r.days} scored days. QLIKE baseline ${f(r.meanBase)} vs model ${f(r.meanModel)} (improvement ${f(100 * r.improvement, 2)}%). DM t=${f(r.dm.t, 2)}, p=${f(r.dm.p)}. Coins better ${r.coinsBetter}/${r.coinsScored} (${f(100 * r.shareBetter, 0)}%).${key === "lHar" ? " Pass mark " + (horizonPasses(r) ? "MET" : "not met") : ""}` : "no scored days"));
  }
  if (decides) say(`VERDICT (HAR; improvement >= 3%, DM p < 0.05 with Newey-West lag 6, >= 70% of coins better; 7-day decides): ${verdict(res.lHar1, res.lHar7)}`);
  return res;
}
say(`Period: ${period}${period === "dev" ? " (bug-finding only, does not decide the verdict)" : " (locked year, decides the verdict)"}. Coins: ${coins.length}. Number of qualifying coins: ${coins.length}.`);
run("MAIN", decision.target, true, true);
say("\nThe following are reported alongside and never decide the verdict:");
run("ROBUSTNESS: without the spike rule", decision.target, false, false);
run("ROBUSTNESS: Parkinson variance", "parkinson", true, false);
if (period === "locked") { writeFileSync("locked-run-results.txt", lines.join("\n") + "\n"); writeFileSync("locked-run.done", `locked year opened ${new Date().toISOString()} target=${decision.target}\n`); }
else writeFileSync("dev-run-results.txt", lines.join("\n") + "\n");
