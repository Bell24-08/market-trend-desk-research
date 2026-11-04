// EXPLORATORY (no pass mark, not pre-registered; the data was already seen). Does the site's trend rule do better than random timing with the same exposure?
// For each coin: the rule enters on "up" readings and leaves on "down" readings (mixed keeps the previous state), as in the old 5-year backtest, with 0.2% per position change.
// It is compared with 1,000 random in/out schedules that have the same number of days in the market and the same number of entries (seed 19).
// node exploratory/trend-vs-random-timing.mjs [path to the folder holding the old backtest's .bt-<COIN>-5y.json files]
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { trendScore } from "../forward/runner.mjs";

const FEE = 0.002, RESAMPLES = 1000, SEED = 19, WARM = 200;
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function equity(pos, r) { // pos[i] is held from close i to close i+1; fee on every change; returns total return and max drawdown
  let e = 1, peak = 1, dd = 0, prev = 0, changes = 0;
  for (let i = 0; i < pos.length; i++) { if (pos[i] !== prev) { e *= 1 - FEE; changes++; prev = pos[i]; } if (pos[i]) e *= 1 + r[i]; peak = Math.max(peak, e); dd = Math.max(dd, 1 - e / peak); }
  return { total: e - 1, dd, changes };
}
function ruleSchedule(closes) {
  const pos = [], r = []; let p = 0;
  for (let d = WARM; d < closes.length - 1; d++) { const t = trendScore(closes.slice(0, d + 1)); if (t.reading === "up") p = 1; else if (t.reading === "down") p = 0; pos.push(p); r.push(closes[d + 1] / closes[d] - 1); }
  return { pos, r };
}
function randomSchedule(n, M, k, rnd) { // k episodes, M days in the market in total, episodes separated by at least one day out
  const pos = new Array(n).fill(0); if (!M || !k) return pos;
  const cuts = new Set(); while (cuts.size < k - 1) cuts.add(1 + Math.floor(rnd() * (M - 1))); const edges = [0, ...[...cuts].sort((a, b) => a - b), M], lens = edges.slice(1).map((v, i) => v - edges[i]);
  const free = n - M - (k - 1); if (free < 0) return pos.fill(1);
  const c2 = new Set(); while (c2.size < k) c2.add(Math.floor(rnd() * (free + k))); const e2 = [-1, ...[...c2].sort((a, b) => a - b)], gaps = e2.slice(1).map((v, i) => v - e2[i] - 1), tail = free - gaps.reduce((x, y) => x + y, 0);
  let at = 0; for (let j = 0; j < k; j++) { at += gaps[j]; for (let q = 0; q < lens[j]; q++) pos[at++] = 1; at += 1; } void tail; return pos;
}
function study(name, closes) {
  const { pos, r } = ruleSchedule(closes), a = equity(pos, r), M = pos.reduce((x, y) => x + y, 0), k = pos.reduce((c, v, i) => c + (v && !(pos[i - 1]) ? 1 : 0), 0), rnd = mulberry32(SEED + name.length);
  const tot = [], dds = []; for (let b = 0; b < RESAMPLES; b++) { const e = equity(randomSchedule(pos.length, M, k, rnd), r); tot.push(e.total); dds.push(e.dd); }
  const hold = equity(pos.map(() => 1), r);
  return { name, days: pos.length, inMarket: M / pos.length, entries: k, rule: a.total, hold: hold.total, randomMedian: median(tot), pctReturn: tot.filter((x) => x < a.total).length / RESAMPLES, ruleDD: a.dd, holdDD: hold.dd, randomMedianDD: median(dds), pctLessDD: dds.filter((x) => x > a.dd).length / RESAMPLES };
}
const fmt = (x, d = 0) => (100 * x).toFixed(d) + "%", rows = [], out = [];
const say = (s = "") => { console.log(s); out.push(s); };

const btDir = process.argv[2];
if (btDir && existsSync(btDir)) for (const c of ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"]) { const f = join(btDir, `.bt-${c}-5y.json`); if (existsSync(f)) rows.push({ set: "6 coins, old 5-year backtest data", ...study(c, JSON.parse(readFileSync(f, "utf8")).map((x) => x.c)) }); }
const coins = JSON.parse(readFileSync("coins.json", "utf8")).selected.map((c) => c.symbol), rd = (p) => (existsSync(p) ? gunzipSync(readFileSync(p)).toString().trim().split("\n").slice(1).map((l) => +l.split(",")[4]) : []);
for (const c of coins) { const closes = [...rd(`data/dev/${c}-daily.csv.gz`), ...rd(`data/locked/${c}-daily.csv.gz`)]; if (closes.length > 400) rows.push({ set: "30 Coinbase coins, 2023-11 to 2026-11", ...study(c, closes) }); }

say("EXPLORATORY: trend rule (enter on up, leave on down, 0.2% per change) vs 1,000 random schedules with the same days in market and the same number of entries. Seed 19. No pass mark; descriptive only.");
say("Percentile of return = share of random schedules the rule beat. Percentile of drawdown = share of random schedules with a deeper drawdown than the rule (higher is better for the rule).");
for (const set of [...new Set(rows.map((r) => r.set))]) {
  const rs = rows.filter((r) => r.set === set); say(`\n== ${set} ==`);
  say("coin   days  in-mkt  rule     hold     random-median  pct(return)  rule-DD  random-DD  pct(DD)");
  for (const r of rs) say(`${r.name.padEnd(6)} ${String(r.days).padStart(5)} ${fmt(r.inMarket).padStart(6)}  ${fmt(r.rule).padStart(7)}  ${fmt(r.hold).padStart(7)}  ${fmt(r.randomMedian).padStart(12)}  ${fmt(r.pctReturn).padStart(10)}  ${fmt(r.ruleDD).padStart(7)}  ${fmt(r.randomMedianDD).padStart(9)}  ${fmt(r.pctLessDD).padStart(6)}`);
  say(`median percentile of return across coins: ${fmt(median(rs.map((r) => r.pctReturn)))}; coins where the rule beat at least 95% of random schedules: ${rs.filter((r) => r.pctReturn >= 0.95).length} of ${rs.length}; beat at least half: ${rs.filter((r) => r.pctReturn >= 0.5).length} of ${rs.length}`);
  say(`median percentile of drawdown across coins: ${fmt(median(rs.map((r) => r.pctLessDD)))}; median in-market share ${fmt(median(rs.map((r) => r.inMarket)))}`);
}
say("\nCaution: the coins move together, so coins are not independent samples; the data was already seen when the rule was designed; random schedules ignore the order of up and down markets. Do not read this as evidence that the rule predicts anything.");
writeFileSync("exploratory/trend-vs-random-timing-results.txt", out.join("\n") + "\n");
