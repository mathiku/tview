// Single-symbol backtest: wires tview's price data into the bot-trader engine.
// The user picks one stock, tunes the built-in pullback/rally strategy, and runs
// it over a date range; we return the trades, equity curve, and a summary.
import { fetchDailyRows, withSmas } from "./stocks.js";
import { runBacktest } from "../bot-trader/backtest/engine.js";
import { summarizeMetrics } from "../bot-trader/backtest/metrics.js";
import { cagrFromMetrics } from "../bot-trader/research/benchmark.js";
import { sma, ema, rsi as rsiSeries, atr as atrSeries, adx as adxSeries, bollinger } from "./indicators.js";
import { compile } from "./strategy-dsl.js";

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

// --- Custom rule (DSL) backtest -------------------------------------------

const SLIPPAGE_PCT = 0.05;
const COMMISSION = 1.0;
// SMA-200 only needs ~200 daily bars, so a couple of years of warmup is plenty
// (no monthly-SMA requirement like the built-in strategy).
const CUSTOM_WARMUP_DAYS = Math.round(2.5 * 365);

function slip(price, action) {
  return action === "buy" ? price * (1 + SLIPPAGE_PCT / 100) : price * (1 - SLIPPAGE_PCT / 100);
}

// Build the per-bar variable context arrays the DSL reads.
function indicatorContext(rows) {
  const closes = rows.map((r) => r.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);
  const ema10 = ema(closes, 10);
  const ema21 = ema(closes, 21);
  const rsi14 = rsiSeries(closes, 14);
  const atr14 = atrSeries(rows, 14);
  const adx14 = adxSeries(rows, 14).adx;
  const pb = bollinger(closes, 20, 2).percentB;

  return rows.map((r, i) => ({
    close: r.close, open: r.open, high: r.high, low: r.low, volume: r.volume,
    sma20: sma20[i], sma50: sma50[i], sma100: sma100[i], sma200: sma200[i],
    ema10: ema10[i], ema21: ema21[i],
    rsi: rsi14[i], adx: adx14[i], atr: atr14[i], percentb: pb[i],
  }));
}

function daysBetween(a, b) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/**
 * Backtest a single symbol against user-written entry/exit rules.
 * @param {object} p - symbol, startDate, endDate, direction ("long"|"short"),
 *   entry (rule text), exit (rule text), initialCapital, positionSizePct,
 *   and optional numeric safety exits stopLossPct/takeProfitPct/maxHoldDays.
 */
export async function runCustomBacktest(p = {}) {
  const symbol = String(p.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) throw new Error("Invalid symbol");

  const startDate = String(p.startDate || "");
  const endDate = String(p.endDate || "");
  if (!ISO_RE.test(startDate) || !ISO_RE.test(endDate)) {
    throw new Error("start and end must be YYYY-MM-DD dates");
  }
  if (startDate >= endDate) throw new Error("start date must be before end date");

  const side = p.direction === "short" ? "short" : "long";

  // Compile rules up front so syntax errors surface as clean 400s.
  let entryRule;
  let exitRule;
  try {
    entryRule = compile(p.entry);
  } catch (err) {
    throw new Error(`Entry rule: ${err.message}`);
  }
  try {
    exitRule = compile(p.exit);
  } catch (err) {
    throw new Error(`Exit rule: ${err.message}`);
  }

  const initialCapital = Math.max(1, num(p.initialCapital, 100_000));
  const positionSizePct = Math.min(1, Math.max(0.01, num(p.positionSizePct, 100) / 100));
  const stopLossPct = num(p.stopLossPct);
  const takeProfitPct = num(p.takeProfitPct);
  const maxHoldDays = num(p.maxHoldDays);

  const period1 = toUnix(startDate) - CUSTOM_WARMUP_DAYS * DAY;
  const period2 = toUnix(endDate) + DAY;
  const rows = await fetchDailyRows(symbol, { period1, period2 });
  if (!rows || rows.length < 200) {
    throw new Error(`Not enough price history for ${symbol} in that range`);
  }

  const ctx = indicatorContext(rows);
  const dates = rows.map((r) => isoDate(r.time));

  let cash = initialCapital;
  let pos = null; // { entryDate, entryPrice, shares, costBasis }
  let pending = false;
  const trades = [];
  const equityCurve = [];

  const pnlPctOf = (entryPrice, close) =>
    side === "long"
      ? ((close - entryPrice) / entryPrice) * 100
      : ((entryPrice - close) / entryPrice) * 100;

  for (let i = 0; i < rows.length; i++) {
    const d = dates[i];
    if (d < startDate) continue;
    if (d > endDate) break;
    const bar = rows[i];
    const vars = ctx[i];
    const prevVars = i > 0 ? ctx[i - 1] : null;

    // 1) Fill a queued entry at this bar's open.
    if (pending && !pos) {
      pending = false;
      const entryPrice = slip(bar.open, side === "long" ? "buy" : "sell");
      const budget = cash * positionSizePct;
      const shares = Math.floor((budget - COMMISSION) / entryPrice);
      if (shares > 0) {
        if (side === "long") {
          const cost = shares * entryPrice + COMMISSION;
          if (cost <= cash) {
            cash -= cost;
            pos = { entryDate: d, entryPrice, shares, costBasis: cost };
          }
        } else {
          const proceeds = shares * entryPrice - COMMISSION;
          cash += proceeds;
          pos = { entryDate: d, entryPrice, shares, costBasis: proceeds };
        }
      }
    }

    // 2) Exit check on this bar's close (rule, then numeric safety stops).
    if (pos) {
      const heldDays = daysBetween(pos.entryDate, d);
      const pnlPct = pnlPctOf(pos.entryPrice, bar.close);
      const exitVars = { ...vars, profit: pnlPct, held: heldDays, bars: heldDays, entryprice: pos.entryPrice };

      let reason = null;
      if (exitRule.evaluate(exitVars, prevVars)) reason = "rule_exit";
      else if (stopLossPct != null && pnlPct <= -stopLossPct) reason = "stop_loss";
      else if (takeProfitPct != null && pnlPct >= takeProfitPct) reason = "take_profit";
      else if (maxHoldDays != null && heldDays >= maxHoldDays) reason = "time_stop";

      if (reason) {
        const exitPrice = slip(bar.close, side === "long" ? "sell" : "buy");
        let pnlUsd;
        if (side === "long") {
          const proceeds = pos.shares * exitPrice - COMMISSION;
          cash += proceeds;
          pnlUsd = proceeds - pos.costBasis;
        } else {
          const coverCost = pos.shares * exitPrice + COMMISSION;
          cash -= coverCost;
          pnlUsd = pos.costBasis - coverCost;
        }
        trades.push({
          side,
          symbol,
          entryDate: pos.entryDate,
          exitDate: d,
          entryPrice: pos.entryPrice,
          exitPrice,
          shares: pos.shares,
          holdDays: heldDays,
          pnlUsd,
          pnlPct: (pnlUsd / pos.costBasis) * 100,
          exitReason: reason,
          signalLabel: "custom",
          patterns: 0,
        });
        pos = null;
      }
    }

    // 3) Scan for a new entry (fills next bar) when flat.
    if (!pos && !pending && entryRule.evaluate(vars, prevVars)) {
      pending = true;
    }

    // Mark-to-market equity.
    let equity = cash;
    if (pos) equity += side === "long" ? pos.shares * bar.close : -pos.shares * bar.close;
    equityCurve.push({ date: d, equity });
  }

  // Force-close any open position at the last bar.
  if (pos) {
    const lastIdx = equityCurve.length ? rows.findIndex((r) => isoDate(r.time) === equityCurve[equityCurve.length - 1].date) : -1;
    const bar = rows[lastIdx >= 0 ? lastIdx : rows.length - 1];
    const d = isoDate(bar.time);
    const exitPrice = slip(bar.close, side === "long" ? "sell" : "buy");
    let pnlUsd;
    if (side === "long") {
      const proceeds = pos.shares * exitPrice - COMMISSION;
      cash += proceeds;
      pnlUsd = proceeds - pos.costBasis;
    } else {
      const coverCost = pos.shares * exitPrice + COMMISSION;
      cash -= coverCost;
      pnlUsd = pos.costBasis - coverCost;
    }
    trades.push({
      side, symbol, entryDate: pos.entryDate, exitDate: d,
      entryPrice: pos.entryPrice, exitPrice, shares: pos.shares,
      holdDays: daysBetween(pos.entryDate, d), pnlUsd,
      pnlPct: (pnlUsd / pos.costBasis) * 100,
      exitReason: "end_of_test", signalLabel: "custom", patterns: 0,
    });
    pos = null;
  }

  const metricsBase = summarizeMetrics(trades, equityCurve, initialCapital);
  const curveStart = equityCurve[0]?.date ?? startDate;
  const cagrPct = cagrFromMetrics(metricsBase.finalEquity ?? initialCapital, initialCapital, curveStart, endDate);
  const metrics = { ...metricsBase, cagrPct };

  const withSma = withSmas(rows);
  const candles = [];
  for (const r of withSma) {
    const dd = isoDate(r.time);
    if (dd < startDate || dd > endDate) continue;
    candles.push({ time: dd, open: r.open, high: r.high, low: r.low, close: r.close, sma100: r.sma100 ?? null, sma200: r.sma200 ?? null });
  }

  return {
    symbol,
    startDate,
    endDate,
    direction: side,
    mode: "custom",
    config: {
      initialCapital,
      positionSizePct: Math.round(positionSizePct * 100),
      entry: String(p.entry || "").trim(),
      exit: String(p.exit || "").trim(),
      stopLossPct,
      takeProfitPct,
      maxHoldDays,
    },
    metrics,
    trades,
    equityCurve: equityCurve.map((pt) => ({ date: pt.date, equity: round2(pt.equity) })),
    candles,
  };
}
