/**
 * Reconstruct a realized-P&L equity curve for a subset of trades (e.g. longs
 * only), ordered by exit date and compounding cumulative pnlUsd on the initial
 * capital. Used for per-side metrics so their return / drawdown reflect that
 * side alone rather than the combined mark-to-market portfolio curve.
 */
export function realizedEquityCurve(trades, initialCapital) {
  const sorted = [...trades].sort((a, b) =>
    a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0
  );
  let equity = initialCapital;
  const curve = [{ date: sorted[0]?.entryDate ?? null, equity }];
  for (const t of sorted) {
    equity += t.pnlUsd;
    curve.push({ date: t.exitDate, equity });
  }
  return curve;
}

export function summarizeMetrics(trades, equityCurve, initialCapital) {
  if (!trades.length) {
    return {
      totalTrades: 0,
      winRate: 0,
      avgPnlPct: 0,
      totalPnlUsd: 0,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      profitFactor: 0,
      avgHoldDays: 0,
      exitBreakdown: {},
    };
  }

  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const totalPnlUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);

  const exitBreakdown = {};
  for (const t of trades) {
    exitBreakdown[t.exitReason] = (exitBreakdown[t.exitReason] ?? 0) + 1;
  }

  let peak = initialCapital;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : initialCapital;

  return {
    totalTrades: trades.length,
    winRate: (wins.length / trades.length) * 100,
    avgPnlPct: trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length,
    totalPnlUsd,
    totalReturnPct: ((finalEquity - initialCapital) / initialCapital) * 100,
    maxDrawdownPct,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgHoldDays: trades.reduce((s, t) => s + t.holdDays, 0) / trades.length,
    exitBreakdown,
    finalEquity,
  };
}

export function formatReport(result, { symbolsScanned, dateRange }) {
  const m = result.metrics;
  const ml = result.metricsLong;
  const ms = result.metricsShort;
  const lines = [
    "",
    "═══════════════════════════════════════════════════════",
    "  BOT-TRADER BACKTEST — Long Pullback + Short Rally",
    "═══════════════════════════════════════════════════════",
    "",
    `Period:        ${dateRange.start} → ${dateRange.end}`,
    `Universe:      ${symbolsScanned} large-cap symbols`,
    `Capital:       $${result.config.backtest.initialCapital.toLocaleString()}`,
    `Sides:         longs=${result.config.backtest.enableLongs}  shorts=${result.config.backtest.enableShorts}`,
    "",
    "── Combined ──────────────────────────────────────────",
    `Total return:  ${fmtPct(m.totalReturnPct)}  ($${fmtMoney(m.totalPnlUsd)})`,
    `Final equity:  $${fmtMoney(m.finalEquity)}`,
    `Max drawdown:  ${fmtPct(-m.maxDrawdownPct)}`,
    `Total trades:  ${m.totalTrades}  (win ${m.winRate.toFixed(1)}%)`,
    `Profit factor: ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"}`,
    "",
    "── Long pullbacks ────────────────────────────────────",
    `Trades:        ${ml.totalTrades}  (win ${ml.winRate.toFixed(1)}%)`,
    `Return:        ${fmtPct(ml.totalReturnPct)}  avg ${fmtPct(ml.avgPnlPct)}/trade`,
    "",
    "── Short rallies ─────────────────────────────────────",
    `Trades:        ${ms.totalTrades}  (win ${ms.winRate.toFixed(1)}%)`,
    `Return:        ${fmtPct(ms.totalReturnPct)}  avg ${fmtPct(ms.avgPnlPct)}/trade`,
    "",
    "── Exit reasons ──────────────────────────────────────",
    ...Object.entries(m.exitBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => `  ${reason.padEnd(16)} ${count}`),
  ];

  const topWinners = [...result.trades].sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 5);
  const topLosers = [...result.trades].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 5);

  if (topWinners.length) {
    lines.push("", "── Top winners ───────────────────────────────────────");
    for (const t of topWinners) {
      lines.push(
        `  ${t.side === "short" ? "↓" : "↑"} ${t.symbol.padEnd(6)} ${t.entryDate} → ${t.exitDate}  ${fmtPct(t.pnlPct)}  ${t.signalLabel ?? ""}`
      );
    }
  }

  if (topLosers.length) {
    lines.push("", "── Top losers ────────────────────────────────────────");
    for (const t of topLosers) {
      lines.push(
        `  ${t.side === "short" ? "↓" : "↑"} ${t.symbol.padEnd(6)} ${t.entryDate} → ${t.exitDate}  ${fmtPct(t.pnlPct)}  ${t.signalLabel ?? ""}`
      );
    }
  }

  lines.push("", "═══════════════════════════════════════════════════════", "");
  return lines.join("\n");
}

function fmtPct(n) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtMoney(n) {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
