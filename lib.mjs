// Shared code for the crypto volatility test. Implements preregistration-volatility-v1.0.md. No dependencies.
export const LN2 = Math.log(2);
const finite = Number.isFinite;
export const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
export const median = (a) => { const s = a.filter(finite).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const dateOf = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
export const dayIndex = (date, start) => Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 864e5);
export const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// ---- variance estimators on one candle (o,h,l,c) ----
export const gk = (o, h, l, c) => 0.5 * Math.log(h / l) ** 2 - (2 * LN2 - 1) * Math.log(c / o) ** 2; // Garman-Klass
export const parkinson = (h, l) => Math.log(h / l) ** 2 / (4 * LN2);
export const FLOOR = 1e-10;

// Hourly realised variance per UTC day. rows: [time(sec), open, high, low, close, volume]. The first return of a day starts at the previous available close.
export function hourlyRV(rows, start, nDays) {
  const t0 = Date.parse(start + "T00:00:00Z") / 1000, close = new Map(rows.map((r) => [r[0], r[4]])), rv = [], missing = [];
  let prev = close.get(t0 - 3600); // the previous day's 23:00 close starts the first return of the first day (the fetch includes that one hour)
  for (let d = 0; d < nDays; d++) {
    let s = 0, got = 0;
    for (let h = 0; h < 24; h++) { const c = close.get(t0 + d * 86400 + h * 3600); if (c === undefined) continue; got++; if (prev !== undefined) s += Math.log(c / prev) ** 2; prev = c; }
    rv.push(got ? s : NaN); missing.push(24 - got);
  }
  return { rv, missing };
}

// Build the per-day series for one coin. dailyRows/krakenRows: [time, o, h, l, c, v] (Kraken rows are already in this order); hourlyRows or null.
// target: "hourly" | "gk" | "parkinson". Returns arrays of length nDays indexed from `start`.
export function buildSeries({ daily, hourly, kraken }, { start, nDays, target }) {
  const byDay = (rows) => { const m = new Array(nDays).fill(null); for (const r of rows || []) { const i = dayIndex(dateOf(r[0]), start); if (i >= 0 && i < nDays) m[i] = r; } return m; };
  const D = byDay(daily), K = byDay(kraken), tv = new Array(nDays).fill(NaN), structVoid = new Array(nDays).fill(false), rg = new Array(nDays).fill(NaN), krRg = new Array(nDays).fill(NaN);
  const hr = target === "hourly" ? hourlyRV(hourly || [], start, nDays) : null;
  for (let i = 0; i < nDays; i++) {
    const c = D[i]; if (c) rg[i] = Math.log(c[2] / c[3]); const k = K[i]; if (k) krRg[i] = Math.log(k[2] / k[3]);
    if (target === "hourly") { if (finite(hr.rv[i])) { tv[i] = Math.max(hr.rv[i], FLOOR); if (hr.missing[i] > 2) structVoid[i] = true; } }
    else if (c) { if (c[2] === c[3]) { structVoid[i] = true; tv[i] = FLOOR; } else tv[i] = Math.max(target === "gk" ? gk(c[1], c[2], c[3], c[4]) : parkinson(c[2], c[3]), FLOOR); }
  }
  // spike rule: flagged when far above the trailing 30-day median; voided only if Kraken does not show the same spike (a single-exchange wick)
  const spike = new Array(nDays).fill(false), trail = (a, i) => median(a.slice(Math.max(0, i - 30), i));
  for (let i = 30; i < nDays; i++) {
    const flagged = target === "hourly" ? tv[i] > 25 * median(tv.slice(Math.max(0, i - 30), i).filter((v, j) => !structVoid[Math.max(0, i - 30) + j])) : rg[i] > 5 * trail(rg, i);
    if (!flagged) continue;
    const km = trail(krRg, i); // Kraken absent or not covering the day: keep the day
    if (finite(krRg[i]) && finite(km) && krRg[i] < 2 * km) spike[i] = true;
  }
  return { tv, structVoid, spike, n: nDays };
}

// ---- small stats ----
export const qlike = (rv, f) => { const r = rv / f; return r - Math.log(r) - 1; };
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; };
export const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
export function ols(X, y) { // least squares by normal equations; returns {b, s2} or null
  const n = X.length, k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let r = 0; r < n; r++) for (let i = 0; i < k; i++) { A[i][k] += X[r][i] * y[r]; for (let j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j]; }
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; } }
  const b = A.map((row, i) => row[k] / row[i]); let sse = 0; for (let r = 0; r < n; r++) { let p = 0; for (let i = 0; i < k; i++) p += X[r][i] * b[i]; sse += (y[r] - p) ** 2; }
  return { b, s2: sse / Math.max(1, n - k) };
}
export function dmTest(d, lag) { // one-sided Diebold-Mariano on a loss-difference series (positive mean = model 1 better), Newey-West variance
  const n = d.length, m = mean(d), g = (j) => { let s = 0; for (let t = j; t < n; t++) s += (d[t] - m) * (d[t - j] - m); return s / n; };
  let v = g(0); for (let j = 1; j <= lag; j++) v += 2 * (1 - j / (lag + 1)) * g(j);
  const t = m / Math.sqrt(Math.max(v, 1e-300) / n); return { n, mean: m, t, p: 1 - normCdf(t) };
}

// ---- the forecast pipeline for one coin and one horizon (h = 1 or 7 days) ----
export function forecastCoin(series, h, cfg) {
  const { applyVoids = true, minTrain = 365, refit = 30, anchorIdx = null, scoreStart, scoreEnd, lambda = 0.94 } = cfg, n = series.n;
  const isVoid = (i) => series.structVoid[i] || (applyVoids && series.spike[i]);
  const inp = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { if (!finite(series.tv[i])) continue; if (!isVoid(i)) inp[i] = series.tv[i];
    else { const w = []; for (let j = Math.max(0, i - 30); j < i; j++) if (finite(series.tv[j]) && !isVoid(j)) w.push(series.tv[j]); inp[i] = w.length ? median(w) : NaN; } }
  const winMean = (i, L) => { if (i - L + 1 < 0) return NaN; let s = 0, c = 0; for (let j = i - L + 1; j <= i; j++) if (finite(inp[j])) { s += inp[j]; c++; } return c >= Math.ceil(0.8 * L) ? s / c : NaN; };
  const m1 = [], m7 = [], m30 = [], f = []; for (let i = 0; i < n; i++) { m1.push(winMean(i, 1)); m7.push(winMean(i, 7)); m30.push(winMean(i, 30)); f.push(finite(m1[i] * m7[i] * m30[i]) ? [1, Math.log(m1[i]), Math.log(m7[i]), Math.log(m30[i])] : null); }
  const R = new Array(n).fill(NaN); for (let i = 0; i + h < n; i++) { let s = 0, ok = true; for (let j = 1; j <= h; j++) { if (!finite(series.tv[i + j]) || isVoid(i + j)) { ok = false; break; } s += series.tv[i + j]; } if (ok) R[i] = s; }
  const ew = new Array(n).fill(NaN); let s2e = NaN; for (let i = 0; i < n; i++) { if (!finite(s2e)) { if (finite(m30[i])) s2e = m30[i]; } else if (finite(inp[i])) s2e = lambda * s2e + (1 - lambda) * inp[i]; ew[i] = s2e; }
  const rowsUpTo = (t0) => { const X = [], y = []; for (let i = 0; i + h <= t0; i++) if (f[i] && finite(R[i])) { X.push(f[i]); y.push(Math.log(R[i])); } return { X, y }; };
  let a = anchorIdx; if (a === null) { a = -1; for (let t0 = 0; t0 < n; t0++) if (rowsUpTo(t0).X.length >= minTrain) { a = t0; break; } }
  const out = { lHar: new Array(n).fill(NaN), lBase: new Array(n).fill(NaN), lEw: new Array(n).fill(NaN) };
  if (a < 0) return out;
  for (let t0 = a; t0 < n; t0 += refit) {
    const { X, y } = rowsUpTo(t0); if (X.length < minTrain) continue; const fit = ols(X, y); if (!fit) continue;
    for (let i = t0; i < Math.min(n, t0 + refit); i++) {
      if (!f[i] || !finite(R[i]) || i + 1 < scoreStart || i + h > scoreEnd) continue;
      const F = Math.exp(fit.b[0] * f[i][0] + fit.b[1] * f[i][1] + fit.b[2] * f[i][2] + fit.b[3] * f[i][3] + 0.5 * fit.s2), base = h * m30[i];
      if (!finite(base)) continue;
      out.lHar[i] = qlike(R[i], F); out.lBase[i] = qlike(R[i], base); if (finite(ew[i])) out.lEw[i] = qlike(R[i], h * ew[i]);
    }
  }
  return out;
}

// Daily series averaged across the coins available that day, then the pass-mark numbers.
export function aggregate(perCoin, key, lag = 6) {
  const names = Object.keys(perCoin), n = perCoin[names[0]].lBase.length, base = [], model = [];
  for (let i = 0; i < n; i++) { const b = [], m = []; for (const c of names) { const x = perCoin[c][key][i], y = perCoin[c].lBase[i]; if (finite(x) && finite(y)) { m.push(x); b.push(y); } } if (m.length) { base.push(mean(b)); model.push(mean(m)); } }
  if (!base.length) return null;
  const improvement = 1 - mean(model) / mean(base), dm = dmTest(base.map((v, i) => v - model[i]), lag);
  const coins = names.map((c) => { const xs = [], bs = []; for (let i = 0; i < n; i++) { const x = perCoin[c][key][i], y = perCoin[c].lBase[i]; if (finite(x) && finite(y)) { xs.push(x); bs.push(y); } } return xs.length ? { coin: c, model: mean(xs), base: mean(bs), better: mean(xs) < mean(bs) } : null; }).filter(Boolean);
  return { days: base.length, meanBase: mean(base), meanModel: mean(model), improvement, dm, coinsScored: coins.length, coinsBetter: coins.filter((c) => c.better).length, shareBetter: coins.filter((c) => c.better).length / coins.length, coins };
}
export const horizonPasses = (r) => !!r && r.improvement >= 0.03 && r.dm.p < 0.05 && r.shareBetter >= 0.7;
export function verdict(r1, r7) { const p7 = horizonPasses(r7), p1 = horizonPasses(r1); return p7 ? (p1 ? "PASS" : "PASS (1-day horizon inconclusive)") : "FAIL"; }
