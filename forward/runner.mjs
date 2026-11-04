// Forward logger for preregistration-forward-v1.0.md. Run daily by .github/workflows/forward.yml at 07:30 WIB (00:30 UTC).
// Each run: check the frozen lib.mjs, verify the ledger, fetch the newly completed UTC days, score matured predictions, write new predictions, extend the digest chain.
// Predictions are append-only and are never rewritten or back-filled.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildSeries, ols, median, qlike, dayIndex, addDays, aggregate } from "../lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, ".."), finite = Number.isFinite;
export const LIB_SHA256 = "5c2a129c88d8ff2df5cedbfe1542d6f3c80b68a9723df4dcc7ef7aa62435e33a"; // lib.mjs at tag code-v1.4
export const CFG = { START: "2023-11-04", FWD_START: "2026-11-04", D0: "2026-11-06", REFIT: 30, MIN_TRAIN: 365, LAMBDA: 0.94, ZERO: "0".repeat(64) };
export const sha = (b) => createHash("sha256").update(b).digest("hex");

export function checkLib(path = join(ROOT, "lib.mjs"), expected = LIB_SHA256) { // aborts loudly if the model code is not byte-identical to code-v1.4
  const got = sha(readFileSync(path));
  if (got !== expected) throw new Error(`lib.mjs does not match the frozen code-v1.4 (expected ${expected}, got ${got}). Refusing to run.`);
  return got;
}

// ---------- data ----------
const readRows = (p, gz) => (existsSync(p) ? (gz ? gunzipSync(readFileSync(p)) : readFileSync(p)).toString().trim().split("\n").slice(1).filter(Boolean).map((l) => l.split(",").map(Number)) : []);
export function loadCoin(sym, root = ROOT, fwd = join(root, "forward")) {
  const g = (k) => readRows(join(root, "data", "dev", `${sym}-${k}.csv.gz`), true).concat(readRows(join(root, "data", "locked", `${sym}-${k}.csv.gz`), true), readRows(join(fwd, "data", `${sym}-${k}.csv`), false));
  return { daily: g("daily"), hourly: g("hourly"), kraken: readRows(join(root, "data", "kraken", `${sym}-daily.csv.gz`), true).concat(readRows(join(fwd, "data-kraken", `${sym}-daily.csv`), false)) };
}
const appendCsv = (p, rows) => { if (!rows.length) return; mkdirSync(dirname(p), { recursive: true }); if (!existsSync(p)) writeFileSync(p, "time,open,high,low,close,volume\n"); appendFileSync(p, rows.map((r) => r.join(",")).join("\n") + "\n"); };
export const hoursOn = (hourly, date) => { const a = Date.parse(date + "T00:00:00Z") / 1000; return hourly.filter((r) => r[0] >= a && r[0] < a + 86400).length; };

const CB = "https://api.exchange.coinbase.com", UA = { "User-Agent": "market-trend-desk-research/1.0" }, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 6) { for (let k = 0; k < tries; k++) { try { const r = await fetch(url, { headers: UA }); if (r.ok) return r.json(); if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url}`); } catch (e) { if (k === tries - 1) throw e; } await sleep(1000 * (k + 1)); } }
async function candles(product, gran, from, to) { // Coinbase rows [time, low, high, open, close, volume], returned as [time, open, high, low, close, volume] oldest first
  const m = new Map(), step = gran * 300;
  for (let s = from; s <= to; s += step) { const e = Math.min(s + step - gran, to); for (const r of (await get(`${CB}/products/${product}/candles?granularity=${gran}&start=${new Date(s * 1e3).toISOString()}&end=${new Date(e * 1e3).toISOString()}`)) || []) m.set(r[0], [r[0], r[3], r[2], r[1], r[4], r[5]]); await sleep(120); }
  return [...m.values()].sort((a, b) => a[0] - b[0]);
}
async function fetchNew(coins, t, fwd, kmap) { // append the completed UTC days up to t to the forward data files (data may be back-filled; predictions may not)
  const end = Date.parse(t + "T23:59:59Z") / 1000;
  for (const c of coins) {
    for (const [kind, gran] of [["hourly", 3600], ["daily", 86400]]) {
      const p = join(fwd, "data", `${c.symbol}-${kind}.csv`), have = readRows(p, false), from = have.length ? have.at(-1)[0] + gran : Date.parse(CFG.FWD_START + "T00:00:00Z") / 1000;
      if (from <= end) appendCsv(p, (await candles(c.product, gran, from, end)).filter((r) => r[0] >= from && r[0] <= end));
    }
    const kp = join(fwd, "data-kraken", `${c.symbol}-daily.csv`), key = kmap(c.symbol);
    if (key) { try { const k = await get(`https://api.kraken.com/0/public/OHLC?pair=${key}&interval=1440`); if (!k.error?.length) { const have = readRows(kp, false), last = have.length ? have.at(-1)[0] : Date.parse("2026-11-03T00:00:00Z") / 1000;
      appendCsv(kp, Object.entries(k.result).find(([n]) => n !== "last")[1].map((r) => [r[0], +r[1], +r[2], +r[3], +r[4], +r[6]]).filter((r) => r[0] > last && r[0] <= end)); } } catch (e) { console.log(`Kraken ${c.symbol}: ${e.message}`); } }
  }
}
async function krakenMap() { const ap = (await get("https://api.kraken.com/0/public/AssetPairs")).result, m = new Map(); for (const [key, p] of Object.entries(ap)) if (p.wsname && p.wsname.endsWith("/USD")) m.set(p.wsname.split("/")[0], key); return (s) => m.get(s) || m.get({ BTC: "XBT", DOGE: "XDG" }[s]); }

// ---------- the HAR forecast for the next days (mirrors lib.forecastCoin; a test checks that they agree) ----------
export function prepare(series, h, applyVoids = true) {
  const n = series.n, isVoid = (i) => series.structVoid[i] || (applyVoids && series.spike[i]), inp = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) { if (!finite(series.tv[i])) continue; if (!isVoid(i)) inp[i] = series.tv[i]; else { const w = []; for (let j = Math.max(0, i - 30); j < i; j++) if (finite(series.tv[j]) && !isVoid(j)) w.push(series.tv[j]); inp[i] = w.length ? median(w) : NaN; } }
  const winMean = (i, L) => { if (i - L + 1 < 0) return NaN; let s = 0, c = 0; for (let j = i - L + 1; j <= i; j++) if (finite(inp[j])) { s += inp[j]; c++; } return c >= Math.ceil(0.8 * L) ? s / c : NaN; };
  const m1 = [], m7 = [], m30 = [], f = []; for (let i = 0; i < n; i++) { m1.push(winMean(i, 1)); m7.push(winMean(i, 7)); m30.push(winMean(i, 30)); f.push(finite(m1[i] * m7[i] * m30[i]) ? [1, Math.log(m1[i]), Math.log(m7[i]), Math.log(m30[i])] : null); }
  const R = new Array(n).fill(NaN); for (let i = 0; i + h < n; i++) { let s = 0, ok = true; for (let j = 1; j <= h; j++) { if (!finite(series.tv[i + j]) || isVoid(i + j)) { ok = false; break; } s += series.tv[i + j]; } if (ok) R[i] = s; }
  const ew = new Array(n).fill(NaN); let s2e = NaN; for (let i = 0; i < n; i++) { if (!finite(s2e)) { if (finite(m30[i])) s2e = m30[i]; } else if (finite(inp[i])) s2e = CFG.LAMBDA * s2e + (1 - CFG.LAMBDA) * inp[i]; ew[i] = s2e; }
  return { n, h, isVoid, inp, m1, m7, m30, f, R, ew };
}
export function forecastAt(P, fitIdx, t) { // fit on rows whose whole target window ended on or before fitIdx, then forecast from the inputs at day t
  const X = [], y = []; for (let i = 0; i + P.h <= fitIdx; i++) if (P.f[i] && finite(P.R[i])) { X.push(P.f[i]); y.push(Math.log(P.R[i])); }
  if (X.length < CFG.MIN_TRAIN || !P.f[t]) return null; const fit = ols(X, y); if (!fit) return null;
  const f = P.f[t], F = Math.exp(fit.b[0] * f[0] + fit.b[1] * f[1] + fit.b[2] * f[2] + fit.b[3] * f[3] + 0.5 * fit.s2);
  return { F, base: P.h * P.m30[t], ewma: P.h * P.ew[t], b: fit.b, s2: fit.s2, rows: X.length };
}
export const fitIndexFor = (t) => { const d0 = dayIndex(CFG.D0, CFG.START); return d0 + CFG.REFIT * Math.floor((t - d0) / CFG.REFIT); };

// ---------- the trend reading (the site's five checks, on Coinbase daily closes) ----------
const rsi14 = (v, n = 14) => { let up = 0, dn = 0; v.slice(-n - 1).forEach((x, i, a) => { if (i) { if (x > a[i - 1]) up += x - a[i - 1]; else dn += a[i - 1] - x; } }); return dn === 0 ? 100 : 100 - 100 / (1 + up / dn); };
export function trendScore(a) {
  if (a.length < 201) return null; const n = a.length - 1, av = (k) => a.slice(-k).reduce((x, y) => x + y, 0) / k, c = a[n], r = rsi14(a);
  const s = [c > av(200), av(50) > av(200), av(20) > av(50), c > a[n - 30], r >= 40 && r <= 70].filter(Boolean).length;
  return { score: s, reading: s >= 4 ? "up" : s <= 1 ? "down" : "mixed" };
}

// ---------- ledger and digest chain ----------
export const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const ledgerFile = (fwd, runDate) => join(fwd, "ledger", `${runDate.slice(0, 7)}.jsonl`), lineCount = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).length : 0);
export function appendLedger(fwd, runDate, rows) { // appends one run's rows to the month file and returns the span for the digest
  const file = ledgerFile(fwd, runDate), name = file.slice(fwd.length + 1).replaceAll("\\", "/"), lines = rows.map((r) => JSON.stringify(r));
  if (!lines.length) return { file: null, start: 0, end: 0, lines: 0, rows_sha: sha("") };
  mkdirSync(dirname(file), { recursive: true }); const start = lineCount(file) + 1; appendFileSync(file, lines.join("\n") + "\n");
  return { file: name, start, end: start + lines.length - 1, lines: lines.length, rows_sha: sha(lines.join("\n")) };
}
export function appendDigest(fwd, runDate, span, meta = {}) {
  const p = join(fwd, "digests.jsonl"), all = readJsonl(p), prev = all.length ? all.at(-1).digest : CFG.ZERO, digest = sha(prev + span.rows_sha);
  const entry = { run_date: runDate, ...span, prev, digest, ...meta }; mkdirSync(fwd, { recursive: true }); appendFileSync(p, JSON.stringify(entry) + "\n"); return entry;
}
export function verifyLedger(fwd) { // catches accidents and edits: every digest line must match its rows, the chain must link, and no ledger line may be unaccounted for
  const problems = [], ds = readJsonl(join(fwd, "digests.jsonl")), cover = {}; let prev = CFG.ZERO;
  for (const d of ds) {
    if (d.prev !== prev) problems.push(`chain broken at ${d.run_date}`); if (sha(d.prev + d.rows_sha) !== d.digest) problems.push(`digest mismatch at ${d.run_date}`); prev = d.digest;
    if (d.lines > 0) { const f = join(fwd, d.file), lines = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : [], seg = lines.slice(d.start - 1, d.end);
      if (seg.length !== d.lines || sha(seg.join("\n")) !== d.rows_sha) problems.push(`ledger rows changed for ${d.run_date}`); const c = (cover[d.file] ||= { next: 1 }); if (d.start !== c.next) problems.push(`gap or overlap in ${d.file} at ${d.run_date}`); c.next = d.end + 1; }
  }
  const dir = join(fwd, "ledger"); if (existsSync(dir)) for (const f of readdirSync(dir)) { const key = `ledger/${f}`; if (lineCount(join(dir, f)) !== (cover[key]?.next ?? 1) - 1) problems.push(`${key} has lines not covered by the digest chain`); }
  return { ok: problems.length === 0, problems, last: ds.at(-1)?.digest || CFG.ZERO };
}

// ---------- scoring of matured predictions ----------
export function scoreRow(pred, P7or1, now) { // P is prepare(series, pred.h); a window with a missing or void day is reported as void, never silently dropped
  const idx = dayIndex(pred.t, CFG.START), R = P7or1.R[idx];
  if (!finite(R)) return { type: "score", id: pred.id, coin: pred.coin, h: pred.h, t: pred.t, voided: true, realised: null, F: pred.F, base: pred.base, ewma: pred.ewma, q_har: null, q_base: null, q_ew: null, scored_at: now };
  return { type: "score", id: pred.id, coin: pred.coin, h: pred.h, t: pred.t, voided: false, realised: R, F: pred.F, base: pred.base, ewma: pred.ewma, q_har: qlike(R, pred.F), q_base: qlike(R, pred.base), q_ew: finite(pred.ewma) ? qlike(R, pred.ewma) : null, scored_at: now };
}
export function scorecard(fwd, asOf) { // descriptive daily summary; the formal verdict is computed once, on the date in the pre-registration
  const out = { as_of: asOf, horizons: {} }, all = []; const dir = join(fwd, "ledger"); if (existsSync(dir)) for (const f of readdirSync(dir).sort()) all.push(...readJsonl(join(dir, f)));
  const preds = all.filter((r) => r.type === "prediction"), scores = all.filter((r) => r.type === "score" && !r.voided), d0 = dayIndex(CFG.D0, CFG.START);
  out.predictions_made = preds.length; out.forecast_days = new Set(preds.map((p) => p.t)).size; out.voided_scores = all.filter((r) => r.type === "score" && r.voided).length;
  for (const h of [1, 7]) { const s = scores.filter((r) => r.h === h), per = {}; if (!s.length) { out.horizons[h] = { scored: 0 }; continue; }
    const span = Math.max(...s.map((r) => dayIndex(r.t, CFG.START))) - d0 + 1;
    for (const r of s) { const o = (per[r.coin] ||= { lHar: new Array(span).fill(NaN), lBase: new Array(span).fill(NaN), lEw: new Array(span).fill(NaN) }), k = dayIndex(r.t, CFG.START) - d0; o.lHar[k] = r.q_har; o.lBase[k] = r.q_base; o.lEw[k] = r.q_ew ?? NaN; }
    const a = aggregate(per, "lHar"), ratio = s.reduce((x, r) => x + r.F, 0) / s.reduce((x, r) => x + r.realised, 0);
    out.horizons[h] = a ? { scored: s.length, days: a.days, improvement: a.improvement, dm_t: a.dm.t, dm_p: a.dm.p, coins_better: a.coinsBetter, coins_scored: a.coinsScored, forecast_to_realised: ratio } : { scored: s.length }; }
  const have = new Set(preds.map((p) => p.t)); out.missed_forecast_days = []; for (let d = CFG.D0; d <= asOf; d = addDays(d, 1)) if (!have.has(d) && d < asOf) out.missed_forecast_days.push(d);
  return out;
}

// ---------- one run ----------
export async function main(env = process.env) {
  const libHash = checkLib(), fwd = env.FORWARD_DIR || join(ROOT, "forward"), now = new Date(env.NOW || Date.now()), runDate = now.toISOString().slice(0, 10), t = addDays(runDate, -1), made = now.toISOString();
  const coins = JSON.parse(readFileSync(join(ROOT, "coins.json"), "utf8")).selected, v = verifyLedger(fwd);
  if (!v.ok) throw new Error("ledger check failed: " + v.problems.join("; "));
  const runnerSha = sha(readFileSync(fileURLToPath(import.meta.url))), commit = env.GITHUB_SHA || "local";
  if (env.NOFETCH !== "1") { const km = await krakenMap(); await fetchNew(coins, t, fwd, km);
    for (;;) { const short = coins.filter((c) => hoursOn(loadCoin(c.symbol, ROOT, fwd).hourly, t) < 22), late = Date.now() < Date.parse(runDate + "T02:00:00Z"); // retry until 09:00 WIB (02:00 UTC), then go on with what is available
      if (!short.length || !late) { if (short.length) console.log("Still short after the retry window:", short.map((c) => c.symbol).join(" ")); break; } console.log("Waiting for complete hourly data:", short.map((c) => c.symbol).join(" ")); await sleep(300000); await fetchNew(coins, t, fwd, km); } }
  const tIdx = dayIndex(t, CFG.START), existing = []; const dir = join(fwd, "ledger"); if (existsSync(dir)) for (const f of readdirSync(dir).sort()) existing.push(...readJsonl(join(dir, f)));
  const preds = new Map(existing.filter((r) => r.type === "prediction").map((r) => [r.id, r])), scored = new Set(existing.filter((r) => r.type === "score").map((r) => r.id)), rows = [], latest = { as_of: t, made_at: made, version: "forward-v1.0", coins: {} };
  for (const c of coins) {
    const data = loadCoin(c.symbol, ROOT, fwd), series = buildSeries(data, { start: CFG.START, nDays: tIdx + 1, target: "hourly" }), P = { 1: prepare(series, 1), 7: prepare(series, 7) }, closes = data.daily.map((r) => r[4]);
    for (const p of preds.values()) if (p.coin === c.symbol && !scored.has(p.id) && dayIndex(p.t, CFG.START) + p.h <= tIdx) rows.push(scoreRow(p, P[p.h], made));
    if (t < CFG.D0) continue;
    const trend = trendScore(closes), hours = hoursOn(data.hourly, t);
    for (const h of [1, 7]) { const id = `${c.symbol}|${h}|${t}`; if (preds.has(id)) continue; const fit = forecastAt(P[h], fitIndexFor(tIdx), tIdx); if (!fit) continue;
      const row = { type: "prediction", id, version: "forward-v1.0", coin: c.symbol, h, t, data_as_of: t, hours_t: hours, target_from: addDays(t, 1), target_to: addDays(t, h), F: fit.F, base: fit.base, ewma: fit.ewma, fit_date: dateAt(fitIndexFor(tIdx)), train_rows: fit.rows, b: fit.b, s2: fit.s2, trend_score: trend?.score ?? null, trend: trend?.reading ?? null, last_close: closes.at(-1), input_sha: sha(JSON.stringify(P[h].inp.slice(-30))), made_at: made, runner_sha: runnerSha, lib_sha: libHash, commit };
      rows.push(row); if (h === 1) (latest.coins[c.symbol] ||= {}).daily = { variance: fit.F, typical_move: Math.sqrt(fit.F) }; else (latest.coins[c.symbol] ||= {}).weekly = { variance: fit.F, typical_move: Math.sqrt(fit.F) }; latest.coins[c.symbol].trend = trend?.reading ?? null; }
  }
  if (env.DRY === "1") { console.log(`DRY run for ${t}: ${rows.length} rows would be written`); return { rows }; }
  const span = appendLedger(fwd, runDate, rows), entry = appendDigest(fwd, runDate, span, { t, runner_sha: runnerSha, lib_sha: libHash, commit });
  mkdirSync(fwd, { recursive: true }); writeFileSync(join(fwd, "scorecard.json"), JSON.stringify(scorecard(fwd, runDate), null, 1) + "\n"); if (Object.keys(latest.coins).length) writeFileSync(join(fwd, "latest.json"), JSON.stringify(latest, null, 1) + "\n");
  console.log(`Run for data day ${t}: ${rows.filter((r) => r.type === "prediction").length} predictions, ${rows.filter((r) => r.type === "score").length} scores. Digest ${entry.digest}`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `digest=${entry.digest}\nrun_date=${runDate}\nt=${t}\n`);
  return { rows, entry };
}
const dateAt = (idx) => addDays(CFG.START, idx);
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
