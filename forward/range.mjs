// 90% ranges for the next-day and next-7-day move, by filtered historical simulation. Implements preregistration-range-v1.0.md.
// Pure functions: no files, no network. The runner calls them once a day; forward/range-report.mjs scores them at the verdict.
import { createHash } from "node:crypto";

export const RANGE = { POOL: 365, MIN_POOL: 330, DRAWS: 10000, ANCHOR_BACK: 420, REFIT: 30, VERSION: "forward-v2.0" };
export const sha = (b) => createHash("sha256").update(b).digest("hex");
export const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
export const rangeSeed = (tIdx, coinIdx, h) => 19 + 1000 * tIdx + coinIdx + (h === 7 ? 500000 : 0);
const finite = Number.isFinite;

// closes: array indexed by data day, NaN where there is no daily candle. F1/F7: arrays indexed by the day the forecast was made (index i = forecast made at the end of day i), NaN where missing.
// 1-day pool for forecast day t: z_s = ln(P_s / P_(s-1)) / sqrt(F1 made at the end of s-1), for the 365 days s = t-364 .. t.
export function pool1(closes, F1, t) {
  const v = []; for (let s = t - RANGE.POOL + 1; s <= t; s++) { if (s < 1) continue; const f = F1[s - 1], a = closes[s], b = closes[s - 1]; if (finite(f) && f > 0 && finite(a) && finite(b) && a > 0 && b > 0) v.push(Math.log(a / b) / Math.sqrt(f)); } return v;
}
// 7-day pool: y_s = ln(P_(s+7) / P_s) / sqrt(F7 made at the end of s), for the 365 windows that end on or before t (s = t-371 .. t-7).
export function pool7(closes, F7, t) {
  const v = []; for (let s = t - 7 - RANGE.POOL + 1; s <= t - 7; s++) { if (s < 0) continue; const f = F7[s], a = closes[s + 7], b = closes[s]; if (finite(f) && f > 0 && finite(a) && finite(b) && a > 0 && b > 0) v.push(Math.log(a / b) / Math.sqrt(f)); } return v;
}
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
// The range: remove the pool's mean, draw with replacement, scale by the current forecast, take the 5th and 95th percentile.
export function makeRange(pool, F, seed, draws = RANGE.DRAWS) {
  if (pool.length < RANGE.MIN_POOL || !(F > 0)) return { lo: null, hi: null, n_pool: pool.length, pool_sha: null, reason: pool.length < RANGE.MIN_POOL ? "pool_short" : "no_forecast" };
  const m = pool.reduce((a, b) => a + b, 0) / pool.length, z = pool.map((x) => x - m), rnd = mulberry32(seed), sd = Math.sqrt(F), sims = new Float64Array(draws);
  for (let i = 0; i < draws; i++) sims[i] = sd * z[Math.floor(rnd() * z.length)];
  const s = Array.from(sims).sort((a, b) => a - b);
  return { lo: quantile(s, 0.05), hi: quantile(s, 0.95), n_pool: pool.length, pool_sha: sha(JSON.stringify(pool)) };
}
// Score one range: the realised log return of the daily close from t to t+h. A window with a void day or a missing candle is reported as void, never dropped.
export function scoreRange(range, closes, t, h, isVoid, now) {
  const a = closes[t], b = closes[t + h], base = { type: "range_score", id: range.id, coin: range.coin, h, t, lo: range.lo, hi: range.hi, scored_at: now };
  let bad = !(finite(a) && finite(b) && a > 0 && b > 0); for (let j = 1; j <= h && !bad; j++) if (isVoid(t + j)) bad = true;
  if (bad || range.lo === null) return { ...base, voided: true, realised: null, inside: null, below: null, above: null };
  const r = Math.log(b / a); return { ...base, voided: false, realised: r, inside: r >= range.lo && r <= range.hi, below: r < range.lo, above: r > range.hi };
}

// ---------- tests of coverage (used by range-report.mjs) ----------
const xlogy = (x, y) => (x === 0 ? 0 : x * Math.log(y));
const chi2sf1 = (x) => { // survival function of chi-square with 1 degree of freedom: erfc(sqrt(x/2))
  const z = Math.sqrt(Math.max(x, 0) / 2), t = 1 / (1 + 0.3275911 * z), y = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z); return Math.min(1, y); };
export function kupiec(n, hits, p = 0.9) { // likelihood-ratio test that the hit rate equals p
  const x = hits, ph = x / n, lr = -2 * (xlogy(x, p) + xlogy(n - x, 1 - p) - xlogy(x, ph) - xlogy(n - x, 1 - ph)); return { n, hits: x, coverage: ph, lr, p: chi2sf1(lr) };
}
export function christoffersen(seq) { // independence of the hit sequence (1 = inside), likelihood ratio on the first-order transition counts
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0; for (let i = 1; i < seq.length; i++) { const a = seq[i - 1], b = seq[i]; if (a === 0 && b === 0) n00++; else if (a === 0 && b === 1) n01++; else if (a === 1 && b === 0) n10++; else n11++; }
  const n0 = n00 + n01, n1 = n10 + n11, tot = n0 + n1; if (!tot || !n0 || !n1) return { lr: NaN, p: NaN, n: tot };
  const p01 = n01 / n0, p11 = n11 / n1, pi = (n01 + n11) / tot, ll1 = xlogy(n00, 1 - p01) + xlogy(n01, p01) + xlogy(n10, 1 - p11) + xlogy(n11, p11), ll0 = xlogy(n00 + n10, 1 - pi) + xlogy(n01 + n11, pi), lr = -2 * (ll0 - ll1);
  return { lr, p: chi2sf1(lr), n: tot };
}
// Pooled coverage with a 95% interval from a block bootstrap: resample whole weeks of dates, all coins together (seed 19, 5,000 resamples).
// rows: [{week, inside}] one per scored coin-day.
export function pooledCoverage(rows, { resamples = 5000, seed = 19 } = {}) {
  if (!rows.length) return { n: 0, coverage: NaN, ci95: null };
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b), by = new Map(weeks.map((w) => [w, [0, 0]])); for (const r of rows) { const c = by.get(r.week); c[0]++; if (r.inside) c[1]++; }
  const rnd = mulberry32(seed), cov = []; for (let b = 0; b < resamples; b++) { let n = 0, k = 0; for (let w = 0; w < weeks.length; w++) { const c = by.get(weeks[Math.floor(rnd() * weeks.length)]); n += c[0]; k += c[1]; } cov.push(k / n); }
  cov.sort((a, b) => a - b); return { n: rows.length, coverage: rows.filter((r) => r.inside).length / rows.length, ci95: [quantile(cov, 0.025), quantile(cov, 0.975)] };
}
