// node test.mjs  offline checks of lib.mjs on synthetic data (no network, no real data, never touches data/locked)
import assert from "node:assert";
import { qlike, ols, dmTest, hourlyRV, buildSeries, forecastCoin, aggregate, verdict, normCdf, median } from "./lib.mjs";

let pass = 0; const t = (name, fn) => { try { fn(); pass++; console.log("PASS", name); } catch (e) { console.error("FAIL", name, "-", e.message); process.exitCode = 1; } };
const rng = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
const synth = (n, phi, seed) => { const r = rng(seed), tv = []; let x = Math.log(1e-3); for (let i = 0; i < n; i++) { x = Math.log(1e-3) + phi * (x - Math.log(1e-3)) + 0.5 * gauss(r); tv.push(Math.exp(x)); } return { tv, structVoid: new Array(n).fill(false), spike: new Array(n).fill(false), n }; };

t("QLIKE is zero for a perfect forecast and positive otherwise", () => { assert.equal(qlike(2, 2), 0); assert.ok(qlike(2, 1) > 0 && qlike(1, 2) > 0); });
t("OLS recovers known coefficients", () => { const X = [], y = []; for (let i = 0; i < 50; i++) { X.push([1, i, i * i % 7]); y.push(2 + 3 * i - 1.5 * (i * i % 7)); } const f = ols(X, y); assert.ok(Math.abs(f.b[0] - 2) < 1e-6 && Math.abs(f.b[1] - 3) < 1e-6 && Math.abs(f.b[2] + 1.5) < 1e-6); });
t("normal CDF sanity", () => { assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6 && Math.abs(normCdf(1.96) - 0.975) < 1e-3); });
t("Diebold-Mariano: a steady advantage is significant, pure noise is not", () => {
  const r = rng(3), good = Array.from({ length: 300 }, () => 0.2 + gauss(r) * 0.5), none = Array.from({ length: 300 }, () => gauss(r) * 0.5);
  assert.ok(dmTest(good, 6).p < 0.001); assert.ok(dmTest(none, 6).p > 0.05);
});
t("hourly realised variance: 24 returns from 25 closes, missing hours counted", () => {
  const t0 = Date.parse("2024-01-02T00:00:00Z") / 1000, rows = []; let c = 100;
  for (let h = -1; h < 24; h++) { c *= h % 2 ? 1.01 : 0.99; rows.push([t0 + h * 3600, c, c, c, c, 1]); }
  const o = hourlyRV(rows, "2024-01-02", 1), expect = 25 - 1; // 25 closes, 24 returns
  let s = 0, p = 100 * 0.99; { let q = 100; for (let h = -1; h < 24; h++) { const n = q * (h % 2 ? 1.01 : 0.99); if (h >= 0) s += Math.log(n / q) ** 2; q = n; } }
  assert.ok(Math.abs(o.rv[0] - s) < 1e-12 && o.missing[0] === 0 && expect === 24);
  const o2 = hourlyRV(rows.filter((r) => ((r[0] - t0) / 3600) % 5 !== 0), "2024-01-02", 1); assert.ok(o2.missing[0] >= 4);
});
t("spike rule: voided only when Kraken does not show the spike; kept if Kraken shows it or is absent", () => {
  const start = "2024-01-01", n = 80, t0 = Date.parse(start + "T00:00:00Z") / 1000, mk = (spikeH) => Array.from({ length: n }, (_, i) => [t0 + i * 86400, 100, i === 60 ? spikeH : 101, 99, 100.2, 1]);
  const base = mk(120), A = buildSeries({ daily: base, kraken: mk(101) }, { start, nDays: n, target: "gk" }), B = buildSeries({ daily: base, kraken: mk(120) }, { start, nDays: n, target: "gk" }), C = buildSeries({ daily: base, kraken: [] }, { start, nDays: n, target: "gk" });
  assert.equal(A.spike[60], true); assert.equal(B.spike[60], false); assert.equal(C.spike[60], false);
});
t("zero-range day is void and floored", () => {
  const start = "2024-01-01", t0 = Date.parse(start + "T00:00:00Z") / 1000, s = buildSeries({ daily: [[t0, 100, 100, 100, 100, 1]], kraken: [] }, { start, nDays: 2, target: "gk" });
  assert.equal(s.structVoid[0], true); assert.equal(s.tv[0], 1e-10);
});
t("no look-ahead: changing data after a date does not change earlier scored losses", () => {
  const a = synth(900, 0.95, 5), b = { ...a, tv: a.tv.slice() }, X = 700; for (let i = X + 1; i < 900; i++) b.tv[i] = a.tv[i] * 50;
  for (const h of [1, 7]) { const cfg = { scoreStart: 0, scoreEnd: 899 }, ra = forecastCoin(a, h, cfg), rb = forecastCoin(b, h, cfg); let checked = 0;
    for (let i = 0; i + h <= X; i++) if (Number.isFinite(ra.lHar[i])) { assert.equal(ra.lHar[i], rb.lHar[i]); assert.equal(ra.lBase[i], rb.lBase[i]); checked++; } assert.ok(checked > 100); }
});
t("HAR beats the 30-day average on persistent synthetic volatility; the verdict logic follows the pass mark", () => {
  const per1 = {}, per7 = {}; for (let c = 0; c < 10; c++) { const s = synth(1400, 0.93, 20 + c); per1["C" + c] = forecastCoin(s, 1, { scoreStart: 800, scoreEnd: 1399, anchorIdx: 799 }); per7["C" + c] = forecastCoin(s, 7, { scoreStart: 800, scoreEnd: 1399, anchorIdx: 799 }); }
  const r1 = aggregate(per1, "lHar"), r7 = aggregate(per7, "lHar"); assert.ok(r1.improvement > 0 && r7.improvement > 0, `improvements ${r1.improvement}, ${r7.improvement}`);
  assert.equal(verdict({ improvement: 0.05, dm: { p: 0.01 }, shareBetter: 0.8 }, { improvement: 0.05, dm: { p: 0.01 }, shareBetter: 0.8 }), "PASS");
  assert.match(verdict({ improvement: 0.01, dm: { p: 0.4 }, shareBetter: 0.4 }, { improvement: 0.05, dm: { p: 0.01 }, shareBetter: 0.8 }), /^PASS \(1-day/);
  assert.equal(verdict({ improvement: 0.05, dm: { p: 0.01 }, shareBetter: 0.8 }, { improvement: 0.02, dm: { p: 0.01 }, shareBetter: 0.8 }), "FAIL");
});
t("a coin with too little history is skipped, not guessed", () => { const s = synth(200, 0.9, 9), r = forecastCoin(s, 1, { scoreStart: 0, scoreEnd: 199 }); assert.ok(r.lHar.every((v) => !Number.isFinite(v))); });
t("median ignores missing values", () => assert.equal(median([1, NaN, 3, 2]), 2));
t("zero-range day is void in hourly mode too (a flat day is not a real zero-variance day)", () => {
  const start = "2024-01-01", t0 = Date.parse(start + "T00:00:00Z") / 1000, hourly = [], daily = [];
  for (let d = 0; d < 3; d++) { for (let h = 0; h < 24; h++) { const px = d === 1 ? 100 : 100 + (h % 3); hourly.push([t0 + d * 86400 + h * 3600, px, px, px, px, 1]); } daily.push([t0 + d * 86400, 100, d === 1 ? 100 : 102, d === 1 ? 100 : 99, 100, 1]); }
  hourly.push([t0 - 3600, 100, 100, 100, 100, 1]); hourly.sort((a, b) => a[0] - b[0]);
  const s = buildSeries({ daily, hourly, kraken: [] }, { start, nDays: 3, target: "hourly" }); assert.equal(s.structVoid[1], true); assert.equal(s.structVoid[0], false);
});
t("spike median ignores zero-range days (a normal 3% day is not flagged because many quiet days sit before it)", () => {
  const start = "2024-01-01", n = 80, t0 = Date.parse(start + "T00:00:00Z") / 1000, mk = (flat) => Array.from({ length: n }, (_, i) => (flat(i) ? [t0 + i * 86400, 100, 100, 100, 100, 1] : [t0 + i * 86400, 100, i === 60 ? 103 : 101, 99, 100.2, 1]));
  const daily = mk((i) => i >= 30 && i < 60 && i % 3 !== 0), kraken = mk(() => false), s = buildSeries({ daily, kraken }, { start, nDays: n, target: "gk" });
  assert.equal(s.spike[60], false);
});
console.log(process.exitCode ? "\nSome checks FAILED" : `\nAll ${pass} checks passed`);
