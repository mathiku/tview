#!/usr/bin/env node
import { formatPaperStatus, runPaperCycle } from "../paper/runner.js";
import { syncOrdersToIbkr, checkIbkrAvailable } from "../paper/ibkr.js";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const refresh = args.has("--refresh");
const useIbkr = args.has("--ibkr");

console.log("Running paper-trading cycle…");

if (useIbkr) {
  const ok = await checkIbkrAvailable();
  if (!ok) {
    console.error(
      "IBKR not reachable. Start TWS or IB Gateway (paper port 7497) and enable API access."
    );
    process.exit(1);
  }
}

const result = await runPaperCycle({ force, refresh });
console.log(formatPaperStatus(result));

if (useIbkr && !result.skipped) {
  const opens = result.actions.filter((a) => a.type === "open");
  const closes = result.actions.filter((a) => a.type === "close");
  if (opens.length || closes.length) {
    console.log("Syncing orders to IBKR paper account…");
    const sync = await syncOrdersToIbkr({ opens, closes });
    console.log(`Account: ${sync.account}`);
    for (const o of sync.placed) {
      console.log(`  order ${o.orderId}: ${o.type} ${o.side} ${o.symbol} ${o.shares ?? ""}`);
    }
  } else {
    console.log("No IBKR orders needed this cycle.");
  }
}
