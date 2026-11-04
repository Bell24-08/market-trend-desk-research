// node fetch.mjs            MODE=dry (default): fetches 3 coins for 8 development-period days and prints counts only. Writes nothing.
// MODE=full node fetch.mjs  the one-off data fetch for preregistration-volatility-v1.0.md. Refuses to run if data/ already exists.
// Runs in a GitHub Action (Coinbase is reachable from there). Writes data files, coins.json, target-decision.json, SHA256SUMS.txt, fetch-log.txt. Analyses nothing.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dateOf } from "./lib.mjs";

const MODE = process.env.MODE || "dry", CB = "https://api.exchange.coinbase.com", UA = { "User-Agent": "market-trend-desk-research/1.0" };
const START = "2023-11-04", DEV_END = "2025-11-03", LOCK_START = "2025-11-04", LOCK_END = "2026-11-03", RANK_FROM = "2025-08-06", HIST_FROM = "2023-01-08", HIST_TO = "2023-11-03", TOP = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = []; const say = (s) => { console.log(s); log.push(s); };
const sec = (d, end = false) => Date.parse(d + (end ? "T23:59:59Z" : "T00:00:00Z")) / 1000;

async function get(url, tries = 6) {
  for (let k = 0; k < tries; k++) { try { const r = await fetch(url, { headers: UA }); if (r.ok) return r.json(); if (r.status !== 429 && r.status < 500) throw new Error(`${r.status} ${url}`); } catch (e) { if (k === tries - 1) throw e; } await sleep(1000 * (k + 1)); }
}
// Coinbase candles come newest first as [time, low, high, open, close, volume]; we store [time, open, high, low, close, volume] oldest first.
async function candles(product, gran, fromSec, toSec) {
  const step = gran * 300, m = new Map();
  for (let s = fromSec; s <= toSec; s += step) {
    const e = Math.min(s + step - gran, toSec), rows = await get(`${CB}/products/${product}/candles?granularity=${gran}&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`);
    for (const r of rows || []) m.set(r[0], [r[0], r[3], r[2], r[1], r[4], r[5]]);
    await sleep(120);
  }
  return [...m.values()].sort((a, b) => a[0] - b[0]);
}
const csv = (rows) => "time,open,high,low,close,volume\n" + rows.map((r) => r.join(",")).join("\n") + "\n";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

const ex = JSON.parse(readFileSync("exclusions.json", "utf8")), excluded = new Map();
for (const [cat, list] of Object.entries(ex)) if (Array.isArray(list)) for (const s of list) excluded.set(s, cat);
const lev = new RegExp(ex.leveraged_token_pattern);
const reasonFor = (p) => excluded.get(p.base_currency) || (lev.test(p.base_currency) ? "leveraged_token_pattern" : null) || (p.fx_stablecoin ? "stablecoin (Coinbase flag)" : null);

async function main() {
  if (MODE === "full" && existsSync("data")) { console.log("data/ already exists: the fetch is a one-off. Refusing to run again."); process.exit(1); }
  say(`Mode ${MODE}. ${new Date().toISOString()}`);
  const products = (await get(`${CB}/products`)).filter((p) => p.quote_currency === "USD" && p.status === "online" && !p.trading_disabled && !p.auction_mode);
  say(`Active Coinbase USD pairs: ${products.length}`);
  let cands = products.map((p) => ({ symbol: p.base_currency, product: p.id, excluded: reasonFor(p) }));
  if (MODE === "dry") cands = cands.filter((c) => ["BTC", "ETH", "SOL"].includes(c.symbol));
  for (const c of cands.filter((c) => !c.excluded)) { // exclusions first, then history, then volume
    const h = await candles(c.product, 86400, sec(HIST_FROM), sec(HIST_TO, true)); if (!h.length) { c.excluded = "first daily candle after 2023-11-03"; continue; }
    const r = await candles(c.product, 86400, sec(RANK_FROM), sec(DEV_END, true)); c.volumeUSD = r.reduce((a, x) => a + x[5] * x[4], 0);
  }
  const eligible = cands.filter((c) => !c.excluded && c.volumeUSD > 0).sort((a, b) => b.volumeUSD - a.volumeUSD), selected = MODE === "dry" ? eligible : eligible.slice(0, TOP);
  say(`Excluded ${cands.filter((c) => c.excluded).length}; eligible ${eligible.length}; selected ${selected.length}`);
  const from = MODE === "dry" ? "2024-01-01" : START, to = MODE === "dry" ? "2024-01-08" : LOCK_END;
  if (MODE === "dry") for (const c of selected) { const h = await candles(c.product, 3600, sec(from), sec(to, true)), d = await candles(c.product, 86400, sec(from), sec(to, true)); say(`${c.symbol}: ${h.length} hourly rows, ${d.length} daily rows for ${from}..${to} (dry run, nothing written)`); }
  if (MODE === "dry") return;

  for (const d of ["data/dev", "data/locked", "data/kraken"]) mkdirSync(d, { recursive: true });
  const cut = sec(LOCK_START), days = Math.round((sec(LOCK_END, true) - sec(START)) / 86400), full = new Map();
  let complete = 0, total = 0;
  for (const c of selected) {
    const hourly = await candles(c.product, 3600, sec(START) - 3600, sec(LOCK_END, true)), daily = await candles(c.product, 86400, sec(START), sec(LOCK_END, true));
    for (const [kind, rows] of [["hourly", hourly], ["daily", daily]]) { // development period and locked year go to different files
      writeFileSync(`data/dev/${c.symbol}-${kind}.csv.gz`, gzipSync(csv(rows.filter((r) => r[0] < cut)))); writeFileSync(`data/locked/${c.symbol}-${kind}.csv.gz`, gzipSync(csv(rows.filter((r) => r[0] >= cut))));
    }
    const per = new Map(); for (const r of hourly) per.set(dateOf(r[0]), (per.get(dateOf(r[0])) || 0) + 1);
    complete += [...per.values()].filter((n) => n >= 22).length; total += days;
    try { // Kraken daily candles (latest 720 only), used only by the spike rule; only days up to the end of the locked year are kept
      const k = await get(`https://api.kraken.com/0/public/OHLC?pair=${c.symbol === "BTC" ? "XBT" : c.symbol}USD&interval=1440`);
      if (!k.error?.length) { const rows = Object.entries(k.result).find(([n]) => n !== "last")[1].map((r) => [r[0], +r[1], +r[2], +r[3], +r[4], +r[6]]).filter((r) => r[0] <= sec(LOCK_END, true)); writeFileSync(`data/kraken/${c.symbol}-daily.csv.gz`, gzipSync(csv(rows))); }
    } catch {}
    await sleep(500); say(`fetched ${c.symbol}`);
  }
  const coverage = complete / total;
  writeFileSync("coins.json", JSON.stringify({ rule: "Coinbase only; exclusions first; top 30 by sum of daily volume x close over 2025-08-06..2025-11-03", exchange: "coinbase", selected: selected.map((c) => ({ symbol: c.symbol, product: c.product, volumeUSD: Math.round(c.volumeUSD) })), excluded: cands.filter((c) => c.excluded).map((c) => ({ symbol: c.symbol, reason: c.excluded })) }, null, 1) + "\n");
  writeFileSync("target-decision.json", JSON.stringify({ coverage, rule: "share of coin-days 2023-11-04..2026-11-03 with >= 22 of 24 hourly candles; >= 0.95 -> hourly realised variance for all coins, otherwise Garman-Klass for all", target: coverage >= 0.95 ? "hourly" : "gk" }, null, 1) + "\n");
  writeFileSync("fetch-log.txt", log.join("\n") + "\n");
  const files = []; const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = `${d}/${n}`; statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk("data"); files.push("coins.json", "target-decision.json", "fetch-log.txt");
  writeFileSync("SHA256SUMS.txt", files.map((p) => `${sha(readFileSync(p))}  ${p}`).join("\n") + "\n");
  say(`Done. Target decision written. No analysis was run.`);
}
await main();
