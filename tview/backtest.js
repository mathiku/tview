// Single-symbol backtest: wires tview's price data into the bot-trader engine.
// The user picks one stock, tunes the built-in pullback/rally strategy, and runs
// it over a date range; we return the trades, equity curve, and a summary.
import { fetchDailyRows, withSmas } from "./stocks.js";
import { runBacktest } from "../bot-trader/backtest/engine.js";

const DAY = 86400;
// Fetch this many days of history *before* the start date. The pullback/rally
// strategy's trendOk check reads the monthly SMA-200, which needs ~17 years of
// bars to resolve — matching the live scanner (which caches ~20y). Too short a
// lookback leaves the monthly SMAs null, trendOk always false, and zero trades.
const HISTORY_BEFORE_START_DAYS = Math.round(20 * 365.25);

// Match bot-trader's rowDate() exactly so chart bar dates line up with trade dates.
function isoDate(unix) {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function toUnix(dateStr) {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Run one symbol through the bot-trader engine.
 * @param {object} p - symbol, startDate, endDate (ISO), direction ("long"|
 *   "short"|"both"), initialCapital, positionSizePct, requirePattern,
 *   stopLossPct, takeProfitPct, maxHoldDays, stopOn200Sma, rsiMax, adxMin.
 */
export async function runSymbolBacktest(p = {}) {
  const symbol = String(p.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) throw new Error("Invalid symbol");

  const startDate = String(p.startDate || "");
  const endDate = String(p.endDate || "");
  if (!ISO_RE.test(startDate) || !ISO_RE.test(endDate)) {
    throw new Error("start and end must be YYYY-MM-DD dates");
  }
  if (startDate >= endDate) throw new Error("start date must be before end date");

  const direction = ["long", "short", "both"].includes(p.direction) ? p.direction : "long";
  const enableLongs = direction === "long" || direction === "both";
  const enableShorts = direction === "short" || direction === "both";

  const period1 = toUnix(startDate) - HISTORY_BEFORE_START_DAYS * DAY;
  const period2 = toUnix(endDate) + DAY;
  const rows = await fetchDailyRows(symbol, { period1, period2 });
  if (!rows || rows.length < 200) {
    throw new Error(`Not enough price history for ${symbol} in that range`);
  }

  const initialCapital = Math.max(1, num(p.initialCapital, 100_000));
  // For a single stock, deploy the whole account per trade by default so the
  // equity curve reflects the strategy's edge on that name.
  const positionSizePct = Math.min(1, Math.max(0.01, num(p.positionSizePct, 100) / 100));

  const options = {
    startDate,
    endDate,
    initialCapital,
    positionSizePct,
    enableLongs,
    enableShorts,
    // One position at a time for a single-symbol run.
    maxPositions: 1,
    maxLongPositions: 1,
    maxShortPositions: 1,
    warmupDays: 220,
    entry: {
      requirePattern: !!p.requirePattern,
      filters: {
        rsiMax: num(p.rsiMax),
        rsiMinShort: null,
        adxMin: num(p.adxMin),
        percentBMax: null,
        percentBMin: null,
        atrBandMult: null,
      },
    },
    exit: {
      stopLossPct: num(p.stopLossPct, 6),
      takeProfitPct: num(p.takeProfitPct, 12),
      maxHoldDays: num(p.maxHoldDays, 20),
      stopOn200Sma: p.stopOn200Sma !== false,
    },
  };

  const result = runBacktest(new Map([[symbol, rows]]), options);

  // Candles for just the displayed range, keyed by ISO date so trade dates map
  // straight onto the chart as markers. SMAs come from the full-history series
  // so the 100/200 lines are already warm at the start of the window.
  const withSma = withSmas(rows);
  const candles = [];
  for (const r of withSma) {
    const d = isoDate(r.time);
    if (d < startDate || d > endDate) continue;
    candles.push({
      time: d,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      sma100: r.sma100 ?? null,
      sma200: r.sma200 ?? null,
    });
  }

  return {
    symbol,
    startDate,
    endDate,
    direction,
    config: {
      initialCapital,
      positionSizePct: Math.round(positionSizePct * 100),
      ...options.exit,
      requirePattern: !!p.requirePattern,
      rsiMax: options.entry.filters.rsiMax,
      adxMin: options.entry.filters.adxMin,
    },
    metrics: result.metrics,
    metricsLong: result.metricsLong,
    metricsShort: result.metricsShort,
    trades: result.trades,
    equityCurve: result.equityCurve.map((pt) => ({ date: pt.date, equity: round2(pt.equity) })),
    candles,
  };
}
