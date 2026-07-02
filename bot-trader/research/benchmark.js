import { rowDate } from "../data/fetch.js";

function filterTimeline(rows, { startDate, endDate }) {
  const startUnix = startDate
    ? Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000)
    : null;
  const endUnix = endDate
    ? Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000)
    : null;

  return rows.filter((row) => {
    if (startUnix != null && row.time < startUnix) return false;
    if (endUnix != null && row.time > endUnix) return false;
    return true;
  });
}

export function computeBuyAndHold(rows, { startDate, endDate, initialCapital, warmupDays = 0 }) {
  const filtered = filterTimeline(rows, { startDate, endDate });
  if (filtered.length < 2) return null;

  const startIdx = Math.min(warmupDays, filtered.length - 2);
  const entryBar = filtered[startIdx];
  const exitBar = filtered[filtered.length - 1];
  const entryPrice = entryBar.open ?? entryBar.close;
  const exitPrice = exitBar.close;
  const shares = Math.floor(initialCapital / entryPrice);
  const finalEquity = shares * exitPrice;

  const startMs = new Date(`${rowDate(entryBar)}T00:00:00Z`).getTime();
  const endMs = new Date(`${rowDate(exitBar)}T00:00:00Z`).getTime();
  const years = Math.max((endMs - startMs) / (365.25 * 86400000), 0.1);

  const equityCurve = [];
  let peak = initialCapital;
  let maxDrawdownPct = 0;

  for (let i = startIdx; i < filtered.length; i++) {
    const equity = shares * filtered[i].close;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    equityCurve.push({ date: rowDate(filtered[i]), equity });
  }

  const totalReturnPct = ((finalEquity - initialCapital) / initialCapital) * 100;
  const cagrPct = (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100;

  return {
    symbol: rows[0]?.symbol ?? "BENCH",
    entryDate: rowDate(entryBar),
    exitDate: rowDate(exitBar),
    totalReturnPct,
    cagrPct,
    maxDrawdownPct,
    finalEquity,
    years,
    equityCurve,
  };
}

export function compareToBenchmark(strategyMetrics, benchmark) {
  if (!benchmark) return { beatsReturn: false, beatsCagr: false, beatsDrawdown: false, beatsAll: false };
  const beatsReturn = strategyMetrics.totalReturnPct > benchmark.totalReturnPct;
  const beatsCagr = strategyMetrics.cagrPct > benchmark.cagrPct;
  const beatsDrawdown = strategyMetrics.maxDrawdownPct < benchmark.maxDrawdownPct;
  return {
    beatsReturn,
    beatsCagr,
    beatsDrawdown,
    beatsAll: beatsReturn && beatsCagr && beatsDrawdown,
    deltaReturn: strategyMetrics.totalReturnPct - benchmark.totalReturnPct,
    deltaCagr: strategyMetrics.cagrPct - benchmark.cagrPct,
    deltaDrawdown: strategyMetrics.maxDrawdownPct - benchmark.maxDrawdownPct,
  };
}

export function cagrFromMetrics(finalEquity, initialCapital, startDate, endDate) {
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T00:00:00Z`).getTime();
  const years = Math.max((endMs - startMs) / (365.25 * 86400000), 0.1);
  return (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100;
}
