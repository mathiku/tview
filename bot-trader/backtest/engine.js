import { BACKTEST, ENTRY, EXIT } from "../config.js";
import { rowDate } from "../data/fetch.js";
import { positionPnlPct, scanEntries, shouldExit, sma200At } from "./signals.js";
import { summarizeMetrics, realizedEquityCurve } from "./metrics.js";
import { cagrFromMetrics } from "../research/benchmark.js";
import { rollingSma } from "../../tview/stocks.js";

/** Precompute a benchmark's SMA series for the optional market-regime filter. */
function buildRegime(universeRows, regimeCfg) {
  if (!regimeCfg?.enabled) return null;
  const rows = universeRows.get(regimeCfg.symbol);
  if (!rows) {
    console.warn(
      `regimeFilter: benchmark ${regimeCfg.symbol} not in universe — filter disabled`
    );
    return null;
  }
  const sma = rollingSma(rows.map((r) => r.close), regimeCfg.smaPeriod ?? 200);
  return { rows, sma };
}

/** true = benchmark above its SMA (risk-on), false = below, null = unknown. */
function regimeBullish(regime, unix) {
  if (!regime) return null;
  const idx = indexAtOrBefore(regime.rows, unix);
  if (idx < 0 || regime.sma[idx] == null) return null;
  return regime.rows[idx].close > regime.sma[idx];
}

function mergeExit(overrides = {}) {
  return {
    ...EXIT,
    ...overrides,
    earlyProfit: { ...EXIT.earlyProfit, ...overrides.earlyProfit },
  };
}

function applySlippage(price, action, slippagePct) {
  const factor =
    action === "buy" ? 1 + slippagePct / 100 : 1 - slippagePct / 100;
  return price * factor;
}

function daysBetween(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.floor(ms / 86400000);
}

function buildTimeline(universeRows) {
  const dateSet = new Set();
  for (const rows of universeRows.values()) {
    for (const row of rows) dateSet.add(row.time);
  }
  return [...dateSet].sort((a, b) => a - b);
}

function indexAtOrBefore(rows, unix) {
  let lo = 0;
  let hi = rows.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].time <= unix) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function filterTimeline(timeline, { startDate, endDate }) {
  const startUnix = startDate
    ? Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000)
    : null;
  const endUnix = endDate
    ? Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000)
    : null;

  return timeline.filter((unix) => {
    if (startUnix != null && unix < startUnix) return false;
    if (endUnix != null && unix > endUnix) return false;
    return true;
  });
}

function countBySide(positions, side) {
  return positions.filter((p) => p.side === side).length;
}

function positionKey(symbol, side) {
  return `${symbol}:${side}`;
}

function openPosition(positions, pending, cfg) {
  if (positions.length >= cfg.maxPositions) return false;
  if (pending.side === "long") {
    if (!cfg.enableLongs || countBySide(positions, "long") >= cfg.maxLongPositions) return false;
  } else if (!cfg.enableShorts || countBySide(positions, "short") >= cfg.maxShortPositions) {
    return false;
  }
  return true;
}

function closePosition(pos, bar, date, exitReason, cfg) {
  const holdDays = daysBetween(pos.entryDate, date);

  if (pos.side === "long") {
    const exitPrice = applySlippage(bar.close, "sell", cfg.slippagePct);
    const proceeds = pos.shares * exitPrice - cfg.commissionPerTrade;
    return {
      trade: {
        side: "long",
        symbol: pos.symbol,
        entryDate: pos.entryDate,
        exitDate: date,
        entryPrice: pos.entryPrice,
        exitPrice,
        shares: pos.shares,
        holdDays,
        pnlUsd: proceeds - pos.costBasis,
        pnlPct: ((proceeds - pos.costBasis) / pos.costBasis) * 100,
        exitReason,
        signalLabel: pos.signal?.label ?? null,
        patterns: pos.signal?.patterns?.count ?? 0,
      },
      cashDelta: proceeds,
    };
  }

  const exitPrice = applySlippage(bar.close, "buy", cfg.slippagePct);
  const coverCost = pos.shares * exitPrice + cfg.commissionPerTrade;
  return {
    trade: {
      side: "short",
      symbol: pos.symbol,
      entryDate: pos.entryDate,
      exitDate: date,
      entryPrice: pos.entryPrice,
      exitPrice,
      shares: pos.shares,
      holdDays,
      pnlUsd: pos.costBasis - coverCost,
      pnlPct: ((pos.costBasis - coverCost) / pos.costBasis) * 100,
      exitReason,
      signalLabel: pos.signal?.label ?? null,
      patterns: pos.signal?.patterns?.count ?? 0,
    },
    cashDelta: -coverCost,
  };
}

function markToMarket(positions, universeRows, unix) {
  let value = 0;
  for (const pos of positions) {
    const rows = universeRows.get(pos.symbol);
    const idx = indexAtOrBefore(rows, unix);
    const price =
      idx >= 0 && rows[idx].time === unix ? rows[idx].close : pos.entryPrice;
    // Long: positions hold assets worth shares*price. Short: entry credited the
    // proceeds to cash already, so the position contributes only the cover
    // liability (-shares*price) — adding shares*(entry-price) double-counts it.
    if (pos.side === "long") value += pos.shares * price;
    else value -= pos.shares * price;
  }
  return value;
}

export function runBacktest(universeRows, options = {}) {
  const entryCfg = { ...ENTRY, ...options.entry };
  const exitCfg = mergeExit(options.exit);
  const cfg = { ...BACKTEST, ...options };
  delete cfg.entry;
  delete cfg.exit;
  const allDates = buildTimeline(universeRows);
  const warmupCutoff = allDates[Math.min(cfg.warmupDays, allDates.length - 1)] ?? allDates[0];
  const timeline = filterTimeline(allDates, cfg).filter((unix) => unix >= warmupCutoff);

  let cash = cfg.initialCapital;
  const openPositions = [];
  const closedTrades = [];
  const pendingEntries = [];
  const equityCurve = [];
  const symbols = [...universeRows.keys()];
  const regime = buildRegime(universeRows, cfg.regimeFilter);

  for (const unix of timeline) {
    const date = rowDate({ time: unix });

    for (const pending of pendingEntries.splice(0)) {
      const rows = universeRows.get(pending.symbol);
      const idx = indexAtOrBefore(rows, unix);
      if (idx < 0) continue;
      const bar = rows[idx];
      if (bar.time !== unix) continue;
      if (!openPosition(openPositions, pending, cfg)) continue;

      const budget = cash * cfg.positionSizePct;

      if (pending.side === "long") {
        const entryPrice = applySlippage(bar.open, "buy", cfg.slippagePct);
        if (budget < entryPrice) continue;
        const shares = Math.floor((budget - cfg.commissionPerTrade) / entryPrice);
        if (shares <= 0) continue;
        const cost = shares * entryPrice + cfg.commissionPerTrade;
        if (cost > cash) continue;
        cash -= cost;
        openPositions.push({
          symbol: pending.symbol,
          side: "long",
          shares,
          entryDate: date,
          entryPrice,
          signal: pending.signal,
          costBasis: cost,
        });
      } else {
        const entryPrice = applySlippage(bar.open, "sell", cfg.slippagePct);
        if (budget < entryPrice) continue;
        const shares = Math.floor((budget - cfg.commissionPerTrade) / entryPrice);
        if (shares <= 0) continue;
        const proceeds = shares * entryPrice - cfg.commissionPerTrade;
        cash += proceeds;
        openPositions.push({
          symbol: pending.symbol,
          side: "short",
          shares,
          entryDate: date,
          entryPrice,
          signal: pending.signal,
          costBasis: proceeds,
        });
      }
    }

    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      const rows = universeRows.get(pos.symbol);
      const idx = indexAtOrBefore(rows, unix);
      if (idx < 0 || rows[idx].time !== unix) continue;

      const bar = rows[idx];
      const holdDays = daysBetween(pos.entryDate, date);
      const sma200 = sma200At(rows, idx);
      const pnlPct = positionPnlPct(pos.side, pos.entryPrice, bar.close);
      pos.peakPnlPct = Math.max(pos.peakPnlPct ?? pnlPct, pnlPct);

      const exitReason = shouldExit(pos.side, {
        entryPrice: pos.entryPrice,
        bar,
        sma200,
        holdDays,
        exitCfg,
        dailyRows: rows,
        barIndex: idx,
        peakPnlPct: pos.peakPnlPct,
      });

      if (!exitReason) continue;

      const { trade, cashDelta } = closePosition(pos, bar, date, exitReason, cfg);
      cash += cashDelta;
      closedTrades.push(trade);
      openPositions.splice(i, 1);
    }

    const held = new Set(openPositions.map((p) => positionKey(p.symbol, p.side)));
    const queued = new Set(pendingEntries.map((p) => positionKey(p.symbol, p.side)));
    const slots = cfg.maxPositions - openPositions.length - pendingEntries.length;

    if (slots > 0) {
      const candidates = [];
      const bull = regimeBullish(regime, unix);

      for (const symbol of symbols) {
        const rows = universeRows.get(symbol);
        const idx = indexAtOrBefore(rows, unix);
        if (idx < 0 || rows[idx].time !== unix) continue;

        const slice = rows.slice(0, idx + 1);
        const entries = scanEntries(slice, {
          enableLongs: cfg.enableLongs,
          enableShorts: cfg.enableShorts,
          entryCfg,
        });

        for (const entry of entries) {
          // Market-regime gate (no-op when disabled or benchmark absent).
          if (bull === true && entry.side === "short") continue;
          if (bull === false && entry.side === "long") continue;
          const key = positionKey(symbol, entry.side);
          if (held.has(key) || queued.has(key)) continue;
          candidates.push({ symbol, side: entry.side, signal: entry.signal, signalDate: date });
        }
      }

      candidates.sort((a, b) => (b.signal?.score ?? 0) - (a.signal?.score ?? 0));
      pendingEntries.push(...candidates.slice(0, slots));
    }

    equityCurve.push({
      date,
      equity: cash + markToMarket(openPositions, universeRows, unix),
      openPositions: openPositions.length,
      longs: countBySide(openPositions, "long"),
      shorts: countBySide(openPositions, "short"),
      cash,
    });
  }

  const lastUnix = timeline[timeline.length - 1];
  const lastDate = rowDate({ time: lastUnix });

  for (const pos of openPositions.splice(0)) {
    const rows = universeRows.get(pos.symbol);
    const idx = indexAtOrBefore(rows, lastUnix);
    const bar = rows[idx];
    const { trade, cashDelta } = closePosition(pos, bar, lastDate, "end_of_test", cfg);
    cash += cashDelta;
    closedTrades.push(trade);
  }

  const longTrades = closedTrades.filter((t) => t.side === "long");
  const shortTrades = closedTrades.filter((t) => t.side === "short");

  const metrics = summarizeMetrics(closedTrades, equityCurve, cfg.initialCapital);
  const endDate = cfg.endDate ?? rowDate({ time: timeline[timeline.length - 1] });
  // Anchor CAGR to when capital actually started working, not the config
  // startDate (warmup can push the real start months later).
  const startDate = equityCurve[0]?.date ?? cfg.startDate;
  const cagrPct = cagrFromMetrics(metrics.finalEquity, cfg.initialCapital, startDate, endDate);

  return {
    config: { backtest: cfg, entry: entryCfg, exit: exitCfg },
    trades: closedTrades,
    equityCurve,
    metrics: { ...metrics, cagrPct },
    // Per-side metrics use each side's own realized-P&L curve so return /
    // drawdown are isolated, not the combined portfolio curve.
    metricsLong: summarizeMetrics(
      longTrades,
      realizedEquityCurve(longTrades, cfg.initialCapital),
      cfg.initialCapital
    ),
    metricsShort: summarizeMetrics(
      shortTrades,
      realizedEquityCurve(shortTrades, cfg.initialCapital),
      cfg.initialCapital
    ),
  };
}
