// Q3 of preregistration-forward-v1.0.md (descriptive, no pass mark): 7-day returns after each trend reading and for all coin-days.
// 95% intervals come from a block bootstrap that resamples whole weeks across all coins together (seed 19, 5,000 resamples).
// node forward/q3.mjs   reads forward/ledger and the daily closes in data/ and forward/data/.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dayIndex } from "../lib.mjs";
import { loadCoin, readJsonl, CFG } from "./runner.mjs";

const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, q = (s, f) => s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))];

// rows: [{reading, week, ret}] one per coin-day. Returns per group (each reading and "all"): n, mean, median, share up, and 95% interval of the mean.
export function q3Stats(rows, { resamples = 5000, seed = 19 } = {}) {
  const groups = { up: [], mixed: [], down: [], all: rows }; for (const r of rows) if (groups[r.reading]) groups[r.reading].push(r);
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b), byWeek = new Map(weeks.map((w) => [w, rows.filter((r) => r.week === w)])), rnd = mulberry32(seed), out = {};
  const boots = { up: [], mixed: [], down: [], all: [] };
  for (let b = 0; b < resamples; b++) { const pick = []; for (let k = 0; k < weeks.length; k++) pick.push(...byWeek.get(weeks[Math.floor(rnd() * weeks.length)]));
    for (const g of Object.keys(groups)) { const sub = g === "all" ? pick : pick.filter((r) => r.reading === g); if (sub.length) boots[g].push(mean(sub.map((r) => r.ret))); } }
  for (const [g, a] of Object.entries(groups)) { if (!a.length) { out[g] = { n: 0 }; continue; } const rets = a.map((r) => r.ret).sort((x, y) => x - y), bs = boots[g].sort((x, y) => x - y);
    out[g] = { n: a.length, mean: mean(rets), median: q(rets, 0.5), share_up: a.filter((r) => r.ret > 0).length / a.length, mean_ci95: bs.length ? [q(bs, 0.025), q(bs, 0.975)] : null, weeks: weeks.length }; }
  return out;
}
export function q3FromLedger(fwd, root) {
  const dir = join(fwd, "ledger"), preds = []; if (existsSync(dir)) for (const f of readdirSync(dir).sort()) preds.push(...readJsonl(join(dir, f)).filter((r) => r.type === "prediction" && r.h === 7 && r.trend));
  const closes = {}, rows = [], d0 = dayIndex(CFG.D0, CFG.START);
  for (const p of preds) { const c = (closes[p.coin] ||= new Map(loadCoin(p.coin, root, fwd).daily.map((r) => [new Date(r[0] * 1e3).toISOString().slice(0, 10), r[4]]))), a = c.get(p.t), b = c.get(new Date(Date.parse(p.t + "T00:00:00Z") + 7 * 864e5).toISOString().slice(0, 10));
    if (a && b) rows.push({ reading: p.trend, week: Math.floor((dayIndex(p.t, CFG.START) - d0) / 7), ret: b / a - 1 }); }
  return q3Stats(rows);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const root = join(dirname(fileURLToPath(import.meta.url)), ".."); console.log(JSON.stringify(q3FromLedger(join(root, "forward"), root), null, 1)); }
