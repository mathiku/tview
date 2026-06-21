import { buildComparison } from "../../tview/stocks.js";
import { isHammer, isShootingStar } from "../../tview/patterns.js";
import { evaluatePullback, evaluateRallyShort, withSmas } from "../../tview/stocks.js";
import { BACKTEST, ENTRY } from "../config.js";

function passesEntryFilters(signal) {
  if (!signal) return false;
  if (ENTRY.requireWatch && !signal.watch) return false;
  if (ENTRY.requirePattern) {
    const count = signal.patterns?.count ?? 0;
    if (count < ENTRY.minPatternCount) return false;
  }
  return true;
}

export function shouldEnterLong(dailyRows) {
  const signal = evaluatePullback(dailyRows);
  if (!passesEntryFilters(signal)) return { enter: false, signal, side: "long" };
  return { enter: true, signal, side: "long" };
}

export function shouldEnterShort(dailyRows) {
  const signal = evaluateRallyShort(dailyRows);
  if (!passesEntryFilters(signal)) return { enter: false, signal, side: "short" };
  return { enter: true, signal, side: "short" };
}

export function scanEntries(dailyRows, { enableLongs = true, enableShorts = true } = {}) {
  const candidates = [];
  if (enableLongs) {
    const long = shouldEnterLong(dailyRows);
    if (long.enter) candidates.push(long);
  }
  if (enableShorts) {
    const short = shouldEnterShort(dailyRows);
    if (short.enter) candidates.push(short);
  }
  return candidates;
}

export function sma200At(rows, index) {
  const series = withSmas(rows.slice(0, index + 1));
  const last = series[series.length - 1];
  return last?.sma200 ?? null;
}

function dailyVs100At(rows, index) {
  const slice = rows.slice(0, index + 1);
  if (slice.length < 200) return null;
  const comparison = buildComparison(slice);
  return comparison["1d"].vs_sma100_pct;
}

export function positionPnlPct(side, entryPrice, close) {
  if (side === "short") {
    return ((entryPrice - close) / entryPrice) * 100;
  }
  return ((close - entryPrice) / entryPrice) * 100;
}

export function shouldExit(
  side,
  {
    entryPrice,
    bar,
    sma200,
    holdDays,
    exitCfg,
    dailyRows = null,
    barIndex = null,
    peakPnlPct = null,
  }
) {
  const pnlPct = positionPnlPct(side, entryPrice, bar.close);
  const ep = exitCfg.earlyProfit;

  if (pnlPct <= -exitCfg.stopLossPct) return "stop_loss";

  if (exitCfg.stopOn200Sma && sma200 != null) {
    if (side === "long" && bar.close < sma200) return "below_200sma";
    if (side === "short" && bar.close > sma200) return "above_200sma";
  }

  if (pnlPct >= exitCfg.takeProfitPct) return "take_profit";

  if (ep?.enabled) {
    const vs100 =
      dailyRows != null && barIndex != null ? dailyVs100At(dailyRows, barIndex) : null;

    if (pnlPct >= ep.minProfitPct && vs100 != null) {
      if (side === "long" && vs100 >= ep.longBounceAbove100Pct) return "bounce_complete";
      if (side === "short" && vs100 <= ep.shortRejectBelow100Pct) return "fade_complete";
    }

    if (ep.oppositePattern && pnlPct >= ep.oppositePatternMinProfitPct && dailyRows != null && barIndex != null) {
      const candle = dailyRows[barIndex];
      if (side === "long" && isShootingStar(candle)) return "reversal_pattern";
      if (side === "short" && isHammer(candle)) return "reversal_pattern";
    }

    if (peakPnlPct != null && peakPnlPct >= ep.trailAfterPct) {
      if (peakPnlPct - pnlPct >= ep.trailDistancePct) return "trail_stop";
    }
  }

  if (holdDays >= exitCfg.maxHoldDays) return "time_stop";
  return null;
}

/** Back-compat alias. */
export function shouldEnter(dailyRows) {
  return shouldEnterLong(dailyRows);
}
