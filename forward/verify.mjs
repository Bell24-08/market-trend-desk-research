// Read-only checks of the forward logger's output. Writes nothing.
// node forward/verify.mjs chain                      the digest chain and every ledger line
// node forward/verify.mjs day 2026-11-06             the predictions for one data day (count, hours, made_at after the day ended, input hash)
// node forward/verify.mjs reproduce 2026-11-06 BTC ETH XRP   recompute the forecasts from the committed data with the runner's own code and compare with the ledger
// node forward/verify.mjs independent                for matured predictions, compare the ledger with lib.forecastCoin (the frozen model code), a path that does not share the runner's forecast code
import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeries, forecastCoin, dayIndex, addDays } from "../lib.mjs";
import { CFG, loadCoin, prepare, forecastAt, fitIndexFor, verifyLedger, readJsonl } from "./runner.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."), FWD = process.env.FORWARD_DIR || join(ROOT, "forward");
const ledger = () => { const d = join(FWD, "ledger"), all = []; if (existsSync(d)) for (const f of readdirSync(d).sort()) all.push(...readJsonl(join(d, f))); return all; };
const series = (sym, t) => buildSeries(loadCoin(sym, ROOT, FWD), { start: CFG.START, nDays: dayIndex(t, CFG.START) + 1, target: "hourly" });
const ok = (b, msg) => { console.log((b ? "OK    " : "FAIL  ") + msg); if (!b) process.exitCode = 1; return b; };
if (process.env.TEST_D0) CFG.D0 = process.env.TEST_D0; // for testing against a ledger built with a shifted D0 only
const [mode, ...args] = process.argv.slice(2);

if (mode === "chain") { const v = verifyLedger(FWD); ok(v.ok, `digest chain and ledger lines (${readJsonl(join(FWD, "digests.jsonl")).length} digest lines)${v.ok ? "" : ": " + v.problems.join("; ")}`); console.log("last digest", v.last); }
else if (mode === "day") {
  const t = args[0], p = ledger().filter((r) => r.type === "prediction" && r.t === t), coins = new Set(p.map((r) => r.coin)), cutoff = Date.parse(addDays(t, 1) + "T00:00:00Z");
  ok(p.length === 60, `${p.length} prediction rows for data day ${t} (expected 60 = 30 coins x 2 horizons)`); ok(coins.size === 30, `${coins.size} coins`);
  ok(p.every((r) => r.data_as_of === t), "every row has data_as_of = " + t); ok(p.every((r) => Date.parse(r.made_at) > cutoff), `every made_at is after the end of data day ${t} (${addDays(t, 1)}T00:00:00Z = 07:00 WIB)`);
  ok(p.every((r) => /^[0-9a-f]{64}$/.test(r.input_sha)), "every row has an input hash"); ok(p.every((r) => Number.isFinite(r.F) && r.F > 0), "every forecast is a positive number");
  const short = p.filter((r) => r.hours_t < 22); ok(short.length === 0, short.length ? `hours below 22 for: ${[...new Set(short.map((r) => r.coin + "(" + r.hours_t + ")"))].join(" ")}` : "every coin had at least 22 hourly candles for the data day");
  ok(p.every((r) => r.version && r.lib_sha === "5c2a129c88d8ff2df5cedbfe1542d6f3c80b68a9723df4dcc7ef7aa62435e33a"), "every row records the frozen lib.mjs hash");
}
else if (mode === "reproduce") {
  const t = args[0], syms = args.slice(1).length ? args.slice(1) : ["BTC", "ETH", "XRP"], tIdx = dayIndex(t, CFG.START); let bad = 0;
  for (const s of syms) { const sr = series(s, t); for (const h of [1, 7]) { const row = ledger().find((r) => r.type === "prediction" && r.id === `${s}|${h}|${t}`); if (!row) { ok(false, `${s} h=${h}: no ledger row`); continue; }
    const f = forecastAt(prepare(sr, h), fitIndexFor(tIdx), tIdx), same = f && Math.abs(f.F - row.F) <= 1e-12 * row.F; if (!same) bad++; ok(same, `${s} h=${h}: ledger F ${row.F.toExponential(6)} vs recomputed ${f ? f.F.toExponential(6) : "none"}${same ? "" : " (a mismatch can come from hours back-filled after the run; check hours_t " + row.hours_t + ")"}`); } }
}
else if (mode === "independent") {
  const preds = ledger().filter((r) => r.type === "prediction"), d0 = dayIndex(CFG.D0, CFG.START); let n = 0, bad = 0;
  for (const sym of [...new Set(preds.map((r) => r.coin))]) { const mature = preds.filter((r) => r.coin === sym && dayIndex(r.t, CFG.START) + r.h <= dayIndex(addDays(preds.map((x) => x.t).sort().at(-1), 0), CFG.START)); if (!mature.length) continue;
    const last = Math.max(...mature.map((r) => dayIndex(r.t, CFG.START) + r.h)), sr = series(sym, addDays(CFG.START, last));
    for (const h of [1, 7]) { const o = forecastCoin(sr, h, { scoreStart: 0, scoreEnd: last, anchorIdx: d0, refit: CFG.REFIT }); for (const r of mature.filter((x) => x.h === h)) { const F = o.F[dayIndex(r.t, CFG.START)]; if (!Number.isFinite(F)) continue; n++; if (Math.abs(F - r.F) > 1e-9 * r.F) { bad++; console.log("FAIL ", r.id, "ledger", r.F, "lib", F); } } } }
  ok(n > 0 && bad === 0, `${n} matured predictions compared with lib.forecastCoin, ${bad} differ`);
}
else console.log("Usage: chain | day <date> | reproduce <date> [coins...] | independent");
