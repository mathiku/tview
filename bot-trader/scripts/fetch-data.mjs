#!/usr/bin/env node
import { BIG_STOCKS } from "../../tview/universe.js";
import { loadUniverseHistory } from "../data/fetch.js";

const symbols = BIG_STOCKS.map((s) => s.symbol);
console.log(`Fetching ${symbols.length} symbols…`);

await loadUniverseHistory(symbols, {
  refresh: true,
  onProgress: ({ done, total, symbol }) => {
    process.stdout.write(`\r  ${done}/${total}  ${symbol ?? ""}`.padEnd(40));
  },
});

console.log("\nDone.");
