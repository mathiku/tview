#!/usr/bin/env node
/** Runs the paper bot every 30 minutes (once per trading day). */
import { formatPaperStatus, runPaperCycle } from "../paper/runner.js";

const INTERVAL_MS = 30 * 60 * 1000;
const useIbkr = process.argv.includes("--ibkr");

console.log(`Paper bot daemon started (interval ${INTERVAL_MS / 60000}m)${useIbkr ? " + IBKR" : ""}`);
console.log("Press Ctrl+C to stop.\n");

async function tick() {
  try {
    const result = await runPaperCycle();
    if (!result.skipped) {
      console.log(formatPaperStatus(result));
      if (useIbkr) {
        const { syncOrdersToIbkr } = await import("../paper/ibkr.js");
        const opens = result.actions.filter((a) => a.type === "open");
        const closes = result.actions.filter((a) => a.type === "close");
        if (opens.length || closes.length) {
          await syncOrdersToIbkr({ opens, closes });
        }
      }
    } else {
      process.stdout.write(`\r${new Date().toLocaleTimeString()} — ${result.reason}`.padEnd(60));
    }
  } catch (err) {
    console.error("\nCycle error:", err.message);
  }
}

await tick();
setInterval(tick, INTERVAL_MS);
