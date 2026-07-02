#!/usr/bin/env node
/**
 * Run all strategy variants vs SPY/QQQ buy-and-hold benchmarks.
 * Usage:
 *   node scripts/run-sweep.mjs           # full universe (~1–2h)
 *   node scripts/run-sweep.mjs --quick   # 60 symbols (~15–25 min)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest } from "../backtest/engine.js";
import { compareToBenchmark, computeBuyAndHold } from "../research/benchmark.js";
import { VARIANTS, resolveVariant } from "../research/variants.js";
import { BACKTEST } from "../config.js";
import { loadSymbolHistory, loadUniverseHistory, rowDate } from "../data/fetch.js";
import { BIG_STOCKS } from "../../tview/universe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quick = process.argv.includes("--quick");
const startDate = BACKTEST.startDate;
const endDate = BACKTEST.endDate ?? rowDate({ time: Math.floor(Date.now() / 1000) });

function pad(s, n) {
  return String(s).padEnd(n);
}

function fmtPct(n) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

async function loadBenchmarks() {
  const benchmarks = {};
  for (const symbol of ["SPY", "QQQ"]) {
    try {
      const rows = await loadSymbolHistory(symbol);
      benchmarks[symbol] = computeBuyAndHold(rows, {
        startDate,
        endDate,
        initialCapital: BACKTEST.initialCapital,
        warmupDays: BACKTEST.warmupDays,
      });
    } catch (err) {
      console.warn(`  skip benchmark ${symbol}: ${err.message}`);
    }
  }
  return benchmarks;
}

console.log(`Strategy sweep ${quick ? "(quick)" : "(full)"} · ${startDate} → ${endDate}\n`);

const symbols = quick
  ? BIG_STOCKS.slice(0, 60).map((s) => s.symbol)
  : BIG_STOCKS.map((s) => s.symbol);

console.log(`Loading ${symbols.length} symbols…`);
const universeRows = await loadUniverseHistory(symbols, {
  onProgress: ({ done, total }) => {
    if (done % 20 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}`);
  },
});
console.log(`\nLoaded ${universeRows.size} symbols.`);

console.log("Loading benchmarks (SPY, QQQ)…");
const benchmarks = await loadBenchmarks();
const spy = benchmarks.SPY;
const qqq = benchmarks.QQQ;

if (spy) {
  console.log(`  SPY buy-and-hold: ${fmtPct(spy.totalReturnPct)} total · ${fmtPct(spy.cagrPct)} CAGR · ${spy.maxDrawdownPct.toFixed(1)}% max DD`);
}
if (qqq) {
  console.log(`  QQQ buy-and-hold: ${fmtPct(qqq.totalReturnPct)} total · ${fmtPct(qqq.cagrPct)} CAGR · ${qqq.maxDrawdownPct.toFixed(1)}% max DD`);
}

console.log(`\nRunning ${VARIANTS.length} strategy variants…\n`);

const results = [];

for (let i = 0; i < VARIANTS.length; i++) {
  const variant = resolveVariant(VARIANTS[i]);
  const t0 = Date.now();
  process.stdout.write(`  [${i + 1}/${VARIANTS.length}] ${variant.name}…`);

  const result = runBacktest(universeRows, {
    ...variant.backtest,
    entry: variant.entry,
    exit: variant.exit,
    startDate,
    endDate,
  });

  const m = result.metrics;
  const vsSpy = compareToBenchmark(
    { totalReturnPct: m.totalReturnPct, cagrPct: m.cagrPct, maxDrawdownPct: m.maxDrawdownPct },
    spy
  );
  const vsQqq = compareToBenchmark(
    { totalReturnPct: m.totalReturnPct, cagrPct: m.cagrPct, maxDrawdownPct: m.maxDrawdownPct },
    qqq
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const beat = vsSpy.beatsCagr ? "✓ beats SPY" : "✗ below SPY";
  console.log(` ${fmtPct(m.cagrPct)} CAGR · ${m.totalTrades} trades · ${elapsed}s · ${beat}`);

  results.push({
    id: variant.id,
    name: variant.name,
    desc: variant.desc,
    totalReturnPct: m.totalReturnPct,
    cagrPct: m.cagrPct,
    maxDrawdownPct: m.maxDrawdownPct,
    totalTrades: m.totalTrades,
    winRate: m.winRate,
    profitFactor: m.profitFactor,
    avgHoldDays: m.avgHoldDays,
    finalEquity: m.finalEquity,
    vsSpy,
    vsQqq,
    config: result.config,
  });
}

results.sort((a, b) => b.cagrPct - a.cagrPct);

console.log("\n══════════════════════════════════════════════════════════════════════════");
console.log("  RANKED BY CAGR vs SPY / QQQ");
console.log("══════════════════════════════════════════════════════════════════════════\n");

if (spy) console.log(`  Benchmark  SPY: ${fmtPct(spy.cagrPct)} CAGR · ${fmtPct(spy.totalReturnPct)} total · DD ${spy.maxDrawdownPct.toFixed(1)}%`);
if (qqq) console.log(`  Benchmark  QQQ: ${fmtPct(qqq.cagrPct)} CAGR · ${fmtPct(qqq.totalReturnPct)} total · DD ${qqq.maxDrawdownPct.toFixed(1)}%\n`);

console.log(
  `  ${pad("Strategy", 28)} ${pad("CAGR", 8)} ${pad("Return", 9)} ${pad("MaxDD", 7)} ${pad("Trades", 7)} ${pad("PF", 5)} vs SPY`
);
console.log(`  ${"─".repeat(78)}`);

for (const r of results) {
  const flag = r.vsSpy.beatsCagr ? "✓" : "·";
  console.log(
    `  ${flag} ${pad(r.name, 26)} ${pad(fmtPct(r.cagrPct), 8)} ${pad(fmtPct(r.totalReturnPct), 9)} ${pad(r.maxDrawdownPct.toFixed(1) + "%", 7)} ${pad(String(r.totalTrades), 7)} ${pad(r.profitFactor.toFixed(2), 5)} ${fmtPct(r.vsSpy.deltaCagr)}`
  );
}

const winners = results.filter((r) => r.vsSpy.beatsCagr && r.vsSpy.beatsDrawdown);
console.log("\n── Beats SPY on CAGR + lower drawdown ─────────────────────────────────────");
if (winners.length) {
  for (const w of winners) {
    console.log(`  ★ ${w.name} — ${fmtPct(w.cagrPct)} CAGR (${fmtPct(w.vsSpy.deltaCagr)} vs SPY) · ${w.desc}`);
  }
} else {
  console.log("  None yet — no variant beat SPY on both return and risk.");
  const best = results[0];
  console.log(`  Closest: ${best.name} at ${fmtPct(best.cagrPct)} CAGR (${fmtPct(best.vsSpy.deltaCagr)} vs SPY)`);
}

const outDir = path.join(__dirname, "..", "research");
await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `sweep-${quick ? "quick-" : ""}${new Date().toISOString().slice(0, 10)}.json`);
await fs.writeFile(
  outFile,
  JSON.stringify({ runAt: new Date().toISOString(), quick, startDate, endDate, benchmarks, results }, null, 2)
);
console.log(`\nFull results: ${outFile}\n`);

// Recommend best config if it beats SPY CAGR
const best = results.find((r) => r.vsSpy.beatsCagr) ?? results[0];
if (best?.vsSpy.beatsCagr) {
  console.log(`Recommendation: adopt "${best.id}" (${best.name}) in config.js`);
}
