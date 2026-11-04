// node forward/test.mjs  offline checks of the forward logger (no network). The workflow runs this before every daily run.
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forecastCoin, qlike, addDays } from "../lib.mjs";
import { CFG, LIB_SHA256, checkLib, prepare, forecastAt, fitIndexFor, trendScore, appendLedger, appendDigest, verifyLedger, scoreRow, readJsonl, main, sha } from "./runner.mjs";
import { q3Stats } from "./q3.mjs";

let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log("PASS", name); } catch (e) { console.error("FAIL", name, "-", e.message); process.exitCode = 1; } };
const rng = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
const synth = (n, phi, seed) => { const r = rng(seed), tv = []; let x = Math.log(1e-3); for (let i = 0; i < n; i++) { x = Math.log(1e-3) + phi * (x - Math.log(1e-3)) + 0.5 * gauss(r); tv.push(Math.exp(x)); } return { tv, structVoid: new Array(n).fill(false), spike: new Array(n).fill(false), n }; };
const tmp = () => mkdtempSync(join(tmpdir(), "fwd-"));

await t("the frozen lib.mjs passes the hash check, and a modified copy makes it fail loudly", () => {
  assert.equal(checkLib(), LIB_SHA256);
  const dir = tmp(), copy = join(dir, "lib.mjs"); writeFileSync(copy, readFileSync(new URL("../lib.mjs", import.meta.url), "utf8") + "\n// changed\n");
  assert.throws(() => checkLib(copy), /does not match the frozen code-v1.4.*Refusing to run/);
});
await t("the forward forecast reproduces lib.forecastCoin exactly, at 1 and 7 days, across refits", () => {
  const s = synth(1200, 0.95, 5), a = 600;
  for (const h of [1, 7]) { const out = forecastCoin(s, h, { scoreStart: 0, scoreEnd: 1199, anchorIdx: a, refit: 30 }), P = prepare(s, h); let k = 0;
    for (let i = a; i + h < 1200; i += 17) if (Number.isFinite(out.F[i])) { const f = forecastAt(P, a + 30 * Math.floor((i - a) / 30), i); assert.ok(Math.abs(f.F - out.F[i]) < 1e-12 * out.F[i], `h=${h} i=${i}`); k++; }
    assert.ok(k > 20, "compared " + k); }
});
await t("refit schedule: fit on D0, then every 30 days", () => {
  const d0 = Math.round((Date.parse(CFG.D0) - Date.parse(CFG.START)) / 864e5);
  assert.equal(fitIndexFor(d0), d0); assert.equal(fitIndexFor(d0 + 29), d0); assert.equal(fitIndexFor(d0 + 30), d0 + 30); assert.equal(fitIndexFor(d0 + 364), d0 + 360);
});
await t("trend reading: a steady rise reads up, a steady fall reads down, too little history reads nothing", () => {
  const up = Array.from({ length: 300 }, (_, i) => 100 + i), down = up.slice().reverse();
  assert.equal(trendScore(up).reading, "up"); assert.equal(trendScore(down).reading, "down"); assert.equal(trendScore(down).score, 0); assert.equal(trendScore(up.slice(0, 100)), null);
});
await t("ledger: a clean chain verifies; an edited row, an edited digest, an extra row or a deleted row is caught", () => {
  const dir = tmp(), day = (d, n) => { const sp = appendLedger(dir, d, Array.from({ length: n }, (_, i) => ({ type: "prediction", id: d + i, F: i + 1 }))); return appendDigest(dir, d, sp); };
  day("2026-11-07", 3); day("2026-11-08", 2); day("2026-12-01", 2); assert.ok(verifyLedger(dir).ok, "clean chain");
  const f = join(dir, "ledger", "2026-11.jsonl"), orig = readFileSync(f, "utf8");
  writeFileSync(f, orig.replace('"F":2', '"F":99')); assert.equal(verifyLedger(dir).ok, false, "edited row"); writeFileSync(f, orig); assert.ok(verifyLedger(dir).ok, "restored");
  appendFileSync(f, JSON.stringify({ type: "prediction", id: "sneaky", F: 1 }) + "\n"); assert.equal(verifyLedger(dir).ok, false, "extra row"); writeFileSync(f, orig);
  writeFileSync(f, orig.split("\n").slice(1).join("\n")); assert.equal(verifyLedger(dir).ok, false, "deleted row"); writeFileSync(f, orig);
  const dg = join(dir, "digests.jsonl"), dorig = readFileSync(dg, "utf8"); writeFileSync(dg, dorig.replace(/"rows_sha":"[0-9a-f]{8}/, '"rows_sha":"deadbeef')); assert.equal(verifyLedger(dir).ok, false, "edited digest");
});
await t("scoring: a matured window gets its QLIKE; a window with a void day is reported as void, not dropped", () => {
  const s = synth(500, 0.9, 3), idx = 300, pred = { id: "X|7|d", coin: "X", h: 7, t: addDays(CFG.START, idx), F: 7e-3, base: 6e-3, ewma: 8e-3 };
  const P = prepare(s, 7), r = scoreRow(pred, P, "now"); assert.equal(r.voided, false); assert.ok(Math.abs(r.q_har - qlike(P.R[idx], 7e-3)) < 1e-15 && Math.abs(r.q_base - qlike(P.R[idx], 6e-3)) < 1e-15);
  s.structVoid[idx + 3] = true; const v = scoreRow(pred, prepare(s, 7), "now"); assert.equal(v.voided, true); assert.equal(v.q_har, null);
});
await t("Q3: the interval is reproducible with the fixed seed, and an unconditional row sits next to each reading", () => {
  const r = rng(9), rows = Array.from({ length: 400 }, (_, i) => ({ reading: ["up", "mixed", "down"][i % 3], week: Math.floor(i / 12), ret: 0.01 * gauss(r) })), a = q3Stats(rows, { resamples: 300 }), b = q3Stats(rows, { resamples: 300 });
  assert.deepEqual(a, b); assert.equal(a.all.n, 400); assert.equal(a.up.n + a.mixed.n + a.down.n, 400); assert.ok(a.all.mean_ci95[0] < a.all.mean && a.all.mean < a.all.mean_ci95[1]);
});
await t("end to end on real data with a shifted D0: predictions are written once, matured ones are scored, nothing is rewritten, the chain verifies", async () => {
  const fwd = tmp(), saved = CFG.D0; CFG.D0 = "2026-06-01";
  try {
    const env = (now) => ({ FORWARD_DIR: fwd, NOFETCH: "1", NOW: now });
    const r1 = await main(env("2026-06-10T01:00:00Z")); const p1 = r1.rows.filter((r) => r.type === "prediction"); assert.equal(p1.length, 60, "30 coins x 2 horizons"); assert.ok(p1.every((r) => r.t === "2026-06-09" && r.lib_sha === LIB_SHA256 && Number.isFinite(r.F) && r.F > 0 && r.trend));
    const r2 = await main(env("2026-06-11T01:00:00Z")); assert.equal(r2.rows.filter((r) => r.type === "score").length, 30, "the 1-day predictions of 06-09 mature on 06-10"); assert.equal(r2.rows.filter((r) => r.type === "prediction").length, 60);
    const r3 = await main(env("2026-06-11T02:00:00Z")); assert.equal(r3.rows.length, 0, "a second run the same day writes no new rows (idempotent)");
    assert.ok(verifyLedger(fwd).ok, verifyLedger(fwd).problems.join("; ")); assert.equal(readJsonl(join(fwd, "digests.jsonl")).length, 3);
    const before = readFileSync(join(fwd, "ledger", "2026-06.jsonl"), "utf8").split("\n").slice(0, 60).join("\n"); assert.equal(before, p1.map((r) => JSON.stringify(r)).join("\n"), "the first day's rows are unchanged");
    assert.ok(existsSync(join(fwd, "scorecard.json")) && existsSync(join(fwd, "latest.json")));
  } finally { CFG.D0 = saved; }
});
console.log(process.exitCode ? "\nSome checks FAILED" : `\nAll ${pass} checks passed`);
