#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BIG_STOCKS } from "../../tview/universe.js";
import { runBacktest } from "../backtest/engine.js";
import { formatReport } from "../backtest/metrics.js";
import { BACKTEST } from "../config.js";
import { loadUniverseHistory, rowDate } from "../data/fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const refresh = args.has("--refresh");
const requirePattern = args.has("--require-pattern");
const longsOnly = args.has("--longs-only");
const shortsOnly = args.has("--shorts-only");

if (requirePattern) {
  const entry = await import("../config.js");
  entry.ENTRY.requirePattern = true;
}

const backtestOverrides = { startDate: BACKTEST.startDate };
if (longsOnly) backtestOverrides.enableShorts = false;
if (shortsOnly) backtestOverrides.enableLongs = false;

const symbols = BIG_STOCKS.map((s) => s.symbol);
console.log(`Loading history for ${symbols.length} symbols${refresh ? " (refresh)" : ""}…`);

const universeRows = await loadUniverseHistory(symbols, {
  refresh,
  onProgress: ({ done, total }) => {
    if (done % 20 === 0 || done === total) {
      process.stdout.write(`\r  ${done}/${total}`);
    }
  },
});
console.log(`\nLoaded ${universeRows.size} symbols.`);

const startDate = BACKTEST.startDate;
const endDate = BACKTEST.endDate ?? rowDate({ time: Math.floor(Date.now() / 1000) });

const result = runBacktest(universeRows, { ...backtestOverrides, startDate, endDate });
const report = formatReport(result, {
  symbolsScanned: universeRows.size,
  dateRange: { start: startDate, end: endDate },
});

console.log(report);

const outDir = path.join(__dirname, "..", "results");
await fs.mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outFile = path.join(outDir, `backtest-${stamp}.json`);
await fs.writeFile(outFile, JSON.stringify(result, null, 2));
console.log(`Full results saved to ${outFile}`);
